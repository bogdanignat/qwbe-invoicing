import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { Effect } from "effect"

import { DomainConflict } from "../../cube/invoicing/index.ts"
import type { ProductPreset } from "../../cube/invoicing/catalog/index.ts"
import { applyMigrations, databasePath } from "./migrations.ts"
import { createSqliteStore } from "./sqlite-store.ts"

const firstPage = { limit: 50 }
const preset: ProductPreset = {
  id: "preset-1", organizationId: "org-a", description: "Audit", unitPrice: "10.00", unitOfMeasure: { code: "HUR", name: "oră" },
}

const withStore = async (use: (store: ReturnType<typeof createSqliteStore>) => Promise<void>) => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-sqlite-catalog-"))
  try {
    applyMigrations(directory)
    await use(createSqliteStore(directory))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

// The service checks ownership before writing; these tests hold the adapter to the
// same rule on its own, so a missing organization filter cannot hide behind the service.
void test("keeps a preset of one organization out of reach of another at the adapter", () => withStore(async (store) => {
  await Effect.runPromise(store.transaction((transaction) => transaction.saveProductPreset(preset)))

  assert.equal(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-b", preset.id))), undefined)
  assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.listProductPresets("org-b", firstPage))), [])
  await Effect.runPromise(store.transaction((transaction) => transaction.deleteProductPreset("org-b", preset.id)))
  const conflict = await Effect.runPromise(Effect.flip(store.transaction((transaction) =>
    transaction.saveProductPreset({ ...preset, organizationId: "org-b", description: "Intrus" }))))
  assert.equal(conflict instanceof DomainConflict && conflict.code === "product_preset_id_taken", true)

  assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", preset.id))), preset)
}))

void test("rolls a preset write back with the surrounding transaction", () => withStore(async (store) => {
  const failure = await Effect.runPromise(Effect.flip(store.transaction((transaction) => Effect.gen(function*() {
    yield* transaction.saveProductPreset(preset)
    return yield* Effect.fail(new DomainConflict({ code: "forced", message: "rollback" }))
  }))))
  assert.equal(failure instanceof DomainConflict, true)
  assert.equal(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", preset.id))), undefined)
}))

void test("round-trips a preferred VAT rate code and stores its absence as NULL", () => withStore(async (store) => {
  const preferring: ProductPreset = { ...preset, id: "preset-2", preferredVatRateCode: "RO_REDUCED" }
  await Effect.runPromise(store.transaction((transaction) => Effect.gen(function*() {
    yield* transaction.saveProductPreset(preset)
    yield* transaction.saveProductPreset(preferring)
  })))
  assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", "preset-2"))), preferring)
  assert.equal(Object.hasOwn(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", preset.id))) ?? {}, "preferredVatRateCode"), false)
  await Effect.runPromise(store.transaction((transaction) => transaction.saveProductPreset(preset)))
  assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", preset.id))), preset)
  const cleared: ProductPreset = { ...preset, id: "preset-2" }
  await Effect.runPromise(store.transaction((transaction) => transaction.saveProductPreset(cleared)))
  assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.findProductPreset("org-a", "preset-2"))), cleared)
}))

void test("refuses an empty or over-long preferred VAT rate code at the table", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-sqlite-catalog-"))
  try {
    applyMigrations(directory)
    const database = new DatabaseSync(databasePath(directory))
    try {
      const insert = database.prepare(`INSERT INTO product_presets(id,organization_id,description,unit_price,unit_code,unit_name,preferred_vat_rate_code)
        VALUES(?,'org-a','Audit','10.00','C62','unitate',?)`)
      assert.throws(() => insert.run("empty", ""), /CHECK constraint failed/)
      assert.throws(() => insert.run("long", "X".repeat(33)), /CHECK constraint failed/)
      insert.run("none", null)
      insert.run("reduced", "RO_REDUCED")
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM product_presets").get()?.count, 2)
    } finally { database.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
