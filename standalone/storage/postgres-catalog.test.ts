import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { DomainConflict } from "../../cube/invoicing/index.ts"
import type { ProductPreset } from "../../cube/invoicing/catalog/index.ts"
import { withMigrated, type TestFixture } from "./postgres-rig.test-support.ts"
import { createPostgresStore } from "./postgres-store.ts"

/**
 * The catalog adapter on PostgreSQL 16. The three service-level cases are
 * unchanged — ownership, rollback and the nullable preferred rate are adapter
 * behaviour, not engine behaviour. The table-level case is the ported one: the
 * refusal is asserted through the named CHECK constraint
 * (`product_presets_vat_rate_code_length`) and SQLSTATE 23514 instead of
 * SQLite's `CHECK constraint failed` text, and the folded index that replaces
 * `COLLATE NOCASE` is checked against its own definition.
 */

const firstPage = { limit: 50 }
const preset: ProductPreset = {
  id: "preset-1", organizationId: "org-a", description: "Audit", unitPrice: "10.00", unitOfMeasure: { code: "HUR", name: "oră" },
}

const withStore = (label: string, use: (store: ReturnType<typeof createPostgresStore>, fixture: TestFixture) => Promise<void>) =>
  withMigrated(label, (fixture) => use(createPostgresStore(fixture.pool), fixture))

// The service checks ownership before writing; these tests hold the adapter to the
// same rule on its own, so a missing organization filter cannot hide behind the service.
void test("keeps a preset of one organization out of reach of another at the adapter", () => withStore("catalog_owner", async (store) => {
  await Effect.runPromise(store.transaction((transaction) => transaction.saveProductPreset(preset)))

  assert.equal(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-b", preset.id))), undefined)
  assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.listProductPresets("org-b", firstPage))), [])
  await Effect.runPromise(store.transaction((transaction) => transaction.deleteProductPreset("org-b", preset.id)))
  const conflict = await Effect.runPromise(Effect.flip(store.transaction((transaction) =>
    transaction.saveProductPreset({ ...preset, organizationId: "org-b", description: "Intrus" }))))
  assert.equal(conflict instanceof DomainConflict && conflict.code === "product_preset_id_taken", true)

  assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", preset.id))), preset)
}))

void test("rolls a preset write back with the surrounding transaction", () => withStore("catalog_rollback", async (store) => {
  const failure = await Effect.runPromise(Effect.flip(store.transaction((transaction) => Effect.gen(function*() {
    yield* transaction.saveProductPreset(preset)
    return yield* Effect.fail(new DomainConflict({ code: "forced", message: "rollback" }))
  }))))
  assert.equal(failure instanceof DomainConflict, true)
  assert.equal(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", preset.id))), undefined)
}))

void test("round-trips a preferred VAT rate code and stores its absence as NULL", () => withStore("catalog_rate", async (store, { sql }) => {
  const preferring: ProductPreset = { ...preset, id: "preset-2", preferredVatRateCode: "RO_REDUCED" }
  await Effect.runPromise(store.transaction((transaction) => Effect.gen(function*() {
    yield* transaction.saveProductPreset(preset)
    yield* transaction.saveProductPreset(preferring)
  })))
  assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", "preset-2"))), preferring)
  assert.equal(Object.hasOwn(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", preset.id))) ?? {}, "preferredVatRateCode"), false)
  // Absence is a real NULL in the column, not an empty string.
  assert.equal(await sql.scalar("SELECT preferred_vat_rate_code FROM product_presets WHERE id=$1", [preset.id]), null)
  await Effect.runPromise(store.transaction((transaction) => transaction.saveProductPreset(preset)))
  assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", preset.id))), preset)
  const cleared: ProductPreset = { ...preset, id: "preset-2" }
  await Effect.runPromise(store.transaction((transaction) => transaction.saveProductPreset(cleared)))
  assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", "preset-2"))), cleared)
}))

void test("refuses an empty or over-long preferred VAT rate code at the table", () => withStore("catalog_check", async (_store, { sql }) => {
  const insert = `INSERT INTO product_presets(id,organization_id,description,unit_price,unit_code,unit_name,preferred_vat_rate_code)
    VALUES($1,'org-a','Audit','10.00','C62','unitate',$2)`
  for (const [id, code] of [["empty", ""], ["long", "X".repeat(33)]] as const) {
    const failure = await sql.rejects(insert, [id, code])
    assert.equal(failure.code, "23514", id)
    assert.equal(failure.constraint, "product_presets_vat_rate_code_length", id)
  }
  await sql.query(insert, ["none", null])
  await sql.query(insert, ["reduced", "RO_REDUCED"])
  assert.equal(Number(await sql.scalar("SELECT count(*) FROM product_presets")), 2)
  // The case-insensitive description order SQLite got from `COLLATE NOCASE` is
  // the folded expression index here, and the adapter's `ORDER BY` has to match
  // it exactly or the keyset walks a different order than the index.
  assert.equal(
    await sql.scalar("SELECT indexdef FROM pg_indexes WHERE indexname='product_presets_organization'"),
    "CREATE INDEX product_presets_organization ON public.product_presets USING btree"
    + " (organization_id, translate(description, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text)"
    + " COLLATE \"C\", id COLLATE \"C\")",
  )
}))
