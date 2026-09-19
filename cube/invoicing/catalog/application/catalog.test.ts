import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { brandingNormalizer, contextProvider, each, emptyState, fixedClock, identity, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"
import { PermissionDenied, ResourceNotFound, ValidationFailure } from "../../contracts/index.ts"
import { unitOfMeasures } from "../../domain/unit-of-measures.ts"

void test("manages tenant product presets with hard deletion", async () => {
  const state = emptyState()
  const generator = sequentialIds()
  const service = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: fixedClock, ids: generator, store: memoryStore(state), branding: brandingNormalizer, cubeIdentity: "invoicing",
  })
  const other = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-2" } }),
    clock: fixedClock, ids: generator, store: memoryStore(state), branding: brandingNormalizer, cubeIdentity: "invoicing",
  })
  const preset = await Effect.runPromise(service.createProductPreset({ description: "  Consultanță  ", unitPrice: "12.5", unitOfMeasure: each }))
  assert.deepEqual(preset, { id: "id-1", organizationId: "org-1", description: "Consultanță", unitPrice: "12.50", unitOfMeasure: each })
  assert.deepEqual(await Effect.runPromise(service.listProductPresets()), { items: [preset], nextCursor: null })
  assert.deepEqual(await Effect.runPromise(other.listProductPresets()), { items: [], nextCursor: null })
  assert.equal(await Effect.runPromise(Effect.flip(other.updateProductPreset({ id: preset.id, description: "X", unitPrice: "1", unitOfMeasure: each }))) instanceof ResourceNotFound, true)
  const changed = await Effect.runPromise(service.updateProductPreset({ id: preset.id, description: "Audit", unitPrice: "20", unitOfMeasure: each }))
  assert.equal(changed.unitPrice, "20.00")
  assert.equal(await Effect.runPromise(Effect.flip(service.createProductPreset({ description: " ", unitPrice: "1", unitOfMeasure: each }))) instanceof ValidationFailure, true)
  assert.equal(await Effect.runPromise(Effect.flip(service.createProductPreset({ description: "Invalid", unitPrice: "1.001", unitOfMeasure: each }))) instanceof ValidationFailure, true)
  await Effect.runPromise(service.deleteProductPreset(preset.id))
  assert.deepEqual(await Effect.runPromise(service.listProductPresets()), { items: [], nextCursor: null })
  assert.equal(await Effect.runPromise(Effect.flip(service.deleteProductPreset(preset.id))) instanceof ResourceNotFound, true)
})

void test("offers the kernel unit-of-measure list to readers only, as copies", async () => {
  const service = (permissions: ReadonlyArray<string>) => createInvoicingService({
    context: contextProvider({ identity: { ...identity, permissions }, organization: { id: "org-1" } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(emptyState()), branding: brandingNormalizer, cubeIdentity: "invoicing",
  })
  const units = await Effect.runPromise(service(identity.permissions).listUnitOfMeasures())
  assert.deepEqual(units, unitOfMeasures)
  assert.notEqual(units[0], unitOfMeasures[0])
  assert.equal(await Effect.runPromise(Effect.flip(service([]).listUnitOfMeasures())) instanceof PermissionDenied, true)
})

const serviceAt = (clock: () => Date, state = emptyState()) => createInvoicingService({
  context: contextProvider({ identity, organization: { id: "org-1" } }),
  clock: { now: Effect.sync(clock) }, ids: sequentialIds(), store: memoryStore(state), branding: brandingNormalizer, cubeIdentity: "invoicing",
})
const book = { description: "Carte", unitPrice: "40", unitOfMeasure: each }

void test("stores a preferred VAT rate code with the preset and drops it when an update omits it", async () => {
  const service = serviceAt(() => new Date("2026-09-01T10:00:00.000Z"))
  const preset = await Effect.runPromise(service.createProductPreset({ ...book, preferredVatRateCode: "RO_REDUCED" }))
  assert.equal(preset.preferredVatRateCode, "RO_REDUCED")
  assert.deepEqual((await Effect.runPromise(service.listProductPresets())).items, [preset])
  const standard = await Effect.runPromise(service.updateProductPreset({ id: preset.id, ...book, preferredVatRateCode: "RO_STANDARD" }))
  assert.equal(standard.preferredVatRateCode, "RO_STANDARD")
  const cleared = await Effect.runPromise(service.updateProductPreset({ id: preset.id, ...book }))
  assert.equal(Object.hasOwn(cleared, "preferredVatRateCode"), false)
  assert.deepEqual((await Effect.runPromise(service.listProductPresets())).items, [cleared])
  const refused = await Effect.runPromise(Effect.flip(service.createProductPreset({ ...book, preferredVatRateCode: "RO_NON_VAT" })))
  assert.equal(refused instanceof ValidationFailure, true)
})

void test("lists a preference the law has retired but refuses to save it again until it is replaced or removed", async () => {
  let now = new Date("2025-07-31T10:00:00.000Z")
  const state = emptyState()
  const service = serviceAt(() => now, state)
  const preset = await Effect.runPromise(service.createProductPreset({ ...book, preferredVatRateCode: "RO_REDUCED_5" }))
  now = new Date("2025-08-01T10:00:00.000Z")
  assert.deepEqual((await Effect.runPromise(service.listProductPresets())).items, [preset])
  const kept = await Effect.runPromise(Effect.flip(service.updateProductPreset({ id: preset.id, ...book, unitPrice: "45", preferredVatRateCode: "RO_REDUCED_5" })))
  assert.equal(kept instanceof ValidationFailure, true)
  assert.deepEqual((await Effect.runPromise(service.listProductPresets())).items, [preset])
  const replaced = await Effect.runPromise(service.updateProductPreset({ id: preset.id, ...book, preferredVatRateCode: "RO_REDUCED" }))
  assert.equal(replaced.preferredVatRateCode, "RO_REDUCED")
  const removed = await Effect.runPromise(service.updateProductPreset({ id: preset.id, ...book }))
  assert.equal(Object.hasOwn(removed, "preferredVatRateCode"), false)
})

void test("checks a preference on the calendar date in Bucharest, not in UTC", async () => {
  const lastSecond = serviceAt(() => new Date("2025-07-31T20:59:59.000Z"))
  assert.equal((await Effect.runPromise(lastSecond.createProductPreset({ ...book, preferredVatRateCode: "RO_REDUCED_5" }))).preferredVatRateCode, "RO_REDUCED_5")
  const nextDay = serviceAt(() => new Date("2025-07-31T21:00:00.000Z"))
  const refused = await Effect.runPromise(Effect.flip(nextDay.createProductPreset({ ...book, preferredVatRateCode: "RO_REDUCED_5" })))
  assert.equal(refused instanceof ValidationFailure, true)
})
