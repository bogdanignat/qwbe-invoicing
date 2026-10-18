import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { brandingNormalizer, contextProvider, emptyState, fixedClock, identity, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"
import { ResourceNotFound, ValidationFailure } from "../../contracts/index.ts"

void test("updates tenant customers and hides them from other organizations and after deletion", async () => {
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
  const customer = await Effect.runPromise(service.createCustomer({
    partyType: "individual", name: "Ion", fiscalIdentifier: "", vatRegistered: false,
    address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" }, defaultPaymentTermDays: 0,
  }))
  assert.equal(customer.defaultPaymentTermDays, 0)
  const updated = await Effect.runPromise(service.updateCustomer({
    id: customer.id, partyType: "individual", name: "Ion Actualizat", fiscalIdentifier: "", vatRegistered: false,
    address: { countryCode: "RO", city: "Cluj", street: "Strada 2", county: "RO-CJ" }, defaultPaymentTermDays: 30,
  }))
  assert.equal(updated.defaultPaymentTermDays, 30)
  assert.equal((await Effect.runPromise(service.getCustomer(customer.id))).name, "Ion Actualizat")
  assert.equal(await Effect.runPromise(Effect.flip(other.getCustomer(customer.id))) instanceof ResourceNotFound, true)
  assert.equal(await Effect.runPromise(Effect.flip(other.updateCustomer({ ...updated, name: "Intrus" }))) instanceof ResourceNotFound, true)
  assert.equal(await Effect.runPromise(Effect.flip(service.updateCustomer({ ...updated, defaultPaymentTermDays: -1 }))) instanceof ValidationFailure, true)
  await Effect.runPromise(service.deleteCustomer(customer.id))
  assert.equal(await Effect.runPromise(Effect.flip(service.getCustomer(customer.id))) instanceof ResourceNotFound, true)
  assert.equal(await Effect.runPromise(Effect.flip(service.updateCustomer(updated))) instanceof ResourceNotFound, true)
})
