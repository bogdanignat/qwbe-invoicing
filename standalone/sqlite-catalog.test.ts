import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { Effect } from "effect"

import { DomainConflict } from "../cube/invoicing/index.ts"
import type { ProductPreset } from "../cube/invoicing/catalog/index.ts"
import { applyMigrations } from "./migrations.ts"
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
