import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "./invoicing.ts"
import { brandingNormalizer, contextProvider, each, emptyState, fixedClock, identity, memoryStore, sequentialIds } from "./memory-store.test-support.ts"
import { PermissionDenied } from "../contracts/index.ts"

void test("refuses missing permissions and cross-organization reads", async () => {
  const state = emptyState()
  const denied = createInvoicingService({
    context: contextProvider({
      identity: { ...identity, permissions: [] },
      organization: { id: "org-1" },
    }),
    clock: fixedClock,
    ids: sequentialIds(),
    store: memoryStore(state),
    branding: brandingNormalizer,
    cubeIdentity: "invoicing",
  })

  const failure = await Effect.runPromise(Effect.flip(denied.configureIssuer({
    name: "Exemplu SRL",
    fiscalIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    legalForm: "srl", tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", iban: "", bankName: "",
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null,
  })))
  assert.equal(failure instanceof PermissionDenied, true)
  assert.equal(await Effect.runPromise(Effect.flip(denied.listProductPresets())) instanceof PermissionDenied, true)
  assert.equal(await Effect.runPromise(Effect.flip(denied.createProductPreset({
    description: "Servicii", unitPrice: "1.00", unitOfMeasure: each,
  }))) instanceof PermissionDenied, true)
  assert.equal(await Effect.runPromise(Effect.flip(denied.updateCustomer({
    id: "missing", partyType: "individual", name: "Ion", fiscalIdentifier: "",
    address: { countryCode: "RO", city: "Iași", street: "Strada 1" },
  }))) instanceof PermissionDenied, true)
})
