import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { contextProvider, emptyState, fixedClock, identity, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"
import { ValidationFailure } from "../../contracts/index.ts"

const address = { countryCode: "RO", city: "Iași", street: "Strada 1" }

void test("pages customers by name with an opaque cursor and validates the page request", async () => {
  const service = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(emptyState()), cubeIdentity: "invoicing",
  })
  for (const name of ["Delta", "alfa", "Charlie", "Bravo", "Echo"]) {
    await Effect.runPromise(service.createCustomer({ partyType: "individual", name, fiscalIdentifier: "", address }))
  }
  const first = await Effect.runPromise(service.listCustomers({ limit: 2 }))
  assert.deepEqual(first.items.map((customer) => customer.name), ["alfa", "Bravo"])
  assert.notEqual(first.nextCursor, null)
  const second = await Effect.runPromise(service.listCustomers({ limit: 2, cursor: first.nextCursor ?? "" }))
  assert.deepEqual(second.items.map((customer) => customer.name), ["Charlie", "Delta"])
  const third = await Effect.runPromise(service.listCustomers({ limit: 2, cursor: second.nextCursor ?? "" }))
  assert.deepEqual(third.items.map((customer) => customer.name), ["Echo"])
  assert.equal(third.nextCursor, null)
  assert.equal((await Effect.runPromise(service.listCustomers())).items.length, 5)

  for (const request of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { cursor: "nu-e-base64-json" }, { cursor: Buffer.from("[1]").toString("base64url") }]) {
    const failure = await Effect.runPromise(Effect.flip(service.listCustomers(request)))
    assert.equal(failure instanceof ValidationFailure, true, JSON.stringify(request))
  }
})
