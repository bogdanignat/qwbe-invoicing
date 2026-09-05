import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { contextProvider, each, emptyState, fixedClock, identity, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"
import { ResourceNotFound, ValidationFailure } from "../../contracts/index.ts"

void test("updates tenant customers and manages hard-deleted product presets", async () => {
  const state = emptyState()
  const generator = sequentialIds()
  const service = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: fixedClock, ids: generator, store: memoryStore(state), cubeIdentity: "invoicing",
  })
  const other = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-2" } }),
    clock: fixedClock, ids: generator, store: memoryStore(state), cubeIdentity: "invoicing",
  })
  const customer = await Effect.runPromise(service.createCustomer({
    partyType: "individual", name: "Ion", fiscalIdentifier: "",
    address: { countryCode: "RO", city: "Iași", street: "Strada 1" }, defaultPaymentTermDays: 0,
  }))
  assert.equal(customer.defaultPaymentTermDays, 0)
  const updated = await Effect.runPromise(service.updateCustomer({
    id: customer.id, partyType: "individual", name: "Ion Actualizat", fiscalIdentifier: "",
    address: { countryCode: "RO", city: "Cluj", street: "Strada 2" }, defaultPaymentTermDays: 30,
  }))
  assert.equal(updated.defaultPaymentTermDays, 30)
  assert.equal((await Effect.runPromise(service.getCustomer(customer.id))).name, "Ion Actualizat")
  assert.equal(await Effect.runPromise(Effect.flip(other.updateCustomer({ ...updated, name: "Intrus" }))) instanceof ResourceNotFound, true)
  assert.equal(await Effect.runPromise(Effect.flip(service.updateCustomer({ ...updated, defaultPaymentTermDays: -1 }))) instanceof ValidationFailure, true)
  await Effect.runPromise(service.deleteCustomer(customer.id))
  assert.equal(await Effect.runPromise(Effect.flip(service.updateCustomer(updated))) instanceof ResourceNotFound, true)

  const preset = await Effect.runPromise(service.createProductPreset({ description: "  Consultanță  ", unitPrice: "12.5", unitOfMeasure: each }))
  assert.deepEqual(preset, { id: "id-2", organizationId: "org-1", description: "Consultanță", unitPrice: "12.50", unitOfMeasure: each })
  assert.deepEqual(await Effect.runPromise(service.listProductPresets()), [preset])
  assert.deepEqual(await Effect.runPromise(other.listProductPresets()), [])
  assert.equal(await Effect.runPromise(Effect.flip(other.updateProductPreset({ id: preset.id, description: "X", unitPrice: "1", unitOfMeasure: each }))) instanceof ResourceNotFound, true)
  const changed = await Effect.runPromise(service.updateProductPreset({ id: preset.id, description: "Audit", unitPrice: "20", unitOfMeasure: each }))
  assert.equal(changed.unitPrice, "20.00")
  assert.equal(await Effect.runPromise(Effect.flip(service.createProductPreset({ description: " ", unitPrice: "1", unitOfMeasure: each }))) instanceof ValidationFailure, true)
  assert.equal(await Effect.runPromise(Effect.flip(service.createProductPreset({ description: "Invalid", unitPrice: "1.001", unitOfMeasure: each }))) instanceof ValidationFailure, true)
  await Effect.runPromise(service.deleteProductPreset(preset.id))
  assert.deepEqual(await Effect.runPromise(service.listProductPresets()), [])
  assert.equal(await Effect.runPromise(Effect.flip(service.deleteProductPreset(preset.id))) instanceof ResourceNotFound, true)
})
