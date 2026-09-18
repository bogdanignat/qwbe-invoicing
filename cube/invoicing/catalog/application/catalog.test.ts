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
