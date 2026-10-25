import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { DomainConflict } from "../../cubes/invoicing/index.ts"
import type { ProductPreset } from "../../cubes/invoicing/catalog/index.ts"
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
  id: "preset-1", organizationId: "org-a", code: "AUD-1", kind: "service", description: "Audit", unitPrice: "10.00",
  unitOfMeasure: { code: "HUR", name: "oră" },
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
  const preferring: ProductPreset = { ...preset, id: "preset-2", code: "AUD-2", preferredVatRateCode: "RO_REDUCED" }
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
  const cleared: ProductPreset = { ...preset, id: "preset-2", code: "AUD-2" }
  await Effect.runPromise(store.transaction((transaction) => transaction.saveProductPreset(cleared)))
  assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", "preset-2"))), cleared)
}))

void test("refuses an empty or over-long preferred VAT rate code at the table", () => withStore("catalog_check", async (_store, { sql }) => {
  const insert = `INSERT INTO product_presets(id,organization_id,code,kind,description,unit_price,unit_code,unit_name,preferred_vat_rate_code)
    VALUES($1,'org-a',$1,'service','Audit',1000,'C62','unitate',$2)`
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

const save = (store: ReturnType<typeof createPostgresStore>, value: ProductPreset) =>
  Effect.runPromise(Effect.either(store.transaction((transaction) => transaction.saveProductPreset(value))))
const takenBy = (code: string) => (result: Awaited<ReturnType<typeof save>>): boolean =>
  result._tag === "Left" && result.left instanceof DomainConflict && result.left.code === "product_preset_code_taken"
  && result.left.message === `Codul ${code} e deja folosit.`

void test("round-trips the code, the kind and a barcode with its leading zeros; no barcode is NULL", () => withStore("catalog_identity", async (store, { sql }) => {
  const coded: ProductPreset = { ...preset, id: "preset-2", code: "S-0001 A/B", kind: "goods", barcode: "00012345600012" }
  await Effect.runPromise(store.transaction((transaction) => Effect.gen(function*() {
    yield* transaction.saveProductPreset(preset)
    yield* transaction.saveProductPreset(coded)
  })))
  assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", "preset-2"))), coded)
  assert.deepEqual(await sql.one("SELECT code, kind, barcode FROM product_presets WHERE id='preset-2'"),
    { code: "S-0001 A/B", kind: "goods", barcode: "00012345600012" })
  assert.equal(await sql.scalar("SELECT barcode FROM product_presets WHERE id=$1", [preset.id]), null)
}))

void test("a taken code, in any case, is the conflict that names it; free in another organization and after deletion", () =>
  withStore("catalog_code_taken", async (store) => {
    assert.equal((await save(store, preset))._tag, "Right")
    assert.equal(takenBy("aud-1")(await save(store, { ...preset, id: "preset-2", code: "aud-1", description: "Copie" })), true)
    assert.equal(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", "preset-2"))), undefined)
    assert.equal((await save(store, { ...preset, id: "preset-3", organizationId: "org-b", code: "aud-1" }))._tag, "Right")
    // Saving a product again under its own code, in another case, is not a clash with itself.
    assert.equal((await save(store, { ...preset, code: "Aud-1", unitPrice: "11.00" }))._tag, "Right")
    assert.equal((await save(store, { ...preset, id: "preset-4", code: "AUD-4" }))._tag, "Right")
    assert.equal(takenBy("AUD-1")(await save(store, { ...preset, id: "preset-4", code: "AUD-1" })), true)
    await Effect.runPromise(store.transaction((transaction) => transaction.deleteProductPreset("org-a", preset.id)))
    assert.equal((await save(store, { ...preset, id: "preset-4", code: "AUD-1" }))._tag, "Right")
    // The code is ASCII, so lower() folds it whole: "ABC" and "abc" are one code.
    assert.equal((await save(store, { ...preset, id: "preset-5", code: "ABC" }))._tag, "Right")
    assert.equal(takenBy("abc")(await save(store, { ...preset, id: "preset-6", code: "abc" })), true)
  }))

void test("of two concurrent saves of one code exactly one wins, and the other gets the conflict", () =>
  withStore("catalog_code_race", async (store, { sql }) => {
    const results = await Promise.all([1, 2].map((index) => save(store, { ...preset, id: `racer-${String(index)}`, code: "RACE" })))
    assert.deepEqual(results.map((result) => result._tag).sort(), ["Left", "Right"])
    assert.equal(results.some(takenBy("RACE")), true)
    assert.equal(Number(await sql.scalar("SELECT count(*) FROM product_presets WHERE lower(code)='race'")), 1)
  }))

void test("the table refuses a malformed code, kind or barcode by name, and indexes the code per organization", () =>
  withStore("catalog_identity_check", async (_store, { sql }) => {
    const insert = (id: string, code: string, kind: string, barcode: string | null) => sql.rejects(
      `INSERT INTO product_presets(id,organization_id,code,kind,description,unit_price,unit_code,unit_name,barcode)
       VALUES($1,'org-a',$2,$3,'Audit',1000,'C62','unitate',$4)`, [id, code, kind, barcode])
    const char = (point: number) => String.fromCodePoint(point)
    for (const code of ["", "x".repeat(51), " A", "A ", `A${char(0xa0)}`, `${char(0x3000)}A`, "A\tB", `A${char(0x85)}`, `A${char(0x2028)}`, `A${char(0x7f)}`,
      "ȘURUB", "Cafe\u0301", "café", "😀", `A${char(0xa0)}B`]) {
      const failure = await insert("bad", code, "goods", null)
      assert.equal(`${failure.code} ${String(failure.constraint)}`, "23514 product_presets_code_shape", JSON.stringify(code))
    }
    const kind = await insert("bad", "K", "Goods", null)
    assert.equal(`${kind.code} ${String(kind.constraint)}`, "23514 product_presets_kind_valid")
    for (const barcode of ["4006381333932", "1234567", "123456789", "400638133393a", "123456789012345", "", " 96385074"]) {
      const failure = await insert("bad", "B", "goods", barcode)
      assert.equal(`${failure.code} ${String(failure.constraint)}`, "23514 product_presets_barcode_gtin", barcode)
    }
    const accepted = [["x".repeat(50), "96385074"], ["SRB/M6 #1 (v2.0)", "036000291452"], ["A-B C", "4006381333931"], ["Z", "10614141000415"], ["~!@{}", null]]
    for (const [index, [code, barcode]] of accepted.entries()) {
      await sql.query(`INSERT INTO product_presets(id,organization_id,code,kind,description,unit_price,unit_code,unit_name,barcode)
        VALUES($1,'org-a',$2,'goods','Audit',1000,'C62','unitate',$3)`, [`ok-${String(index)}`, code, barcode])
    }
    assert.equal(Number(await sql.scalar("SELECT count(*) FROM product_presets")), accepted.length)
    assert.equal(await sql.scalar("SELECT indexdef FROM pg_indexes WHERE indexname='product_presets_code'"),
      "CREATE UNIQUE INDEX product_presets_code ON public.product_presets USING btree (organization_id, lower(code))")
  }))
