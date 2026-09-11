import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { brandingNormalizer, contextProvider, each, emptyState, fixedClock, identity, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"
import { ResourceNotFound, ValidationFailure } from "../../contracts/index.ts"
import { PermissionDenied } from "../../contracts/failures.ts"

const issuerInput = (branding: Parameters<ReturnType<typeof createInvoicingService>["configureIssuer"]>[0]["branding"]) => ({
  name: "Exemplu SRL", fiscalIdentifier: "RO12345674",
  address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
  defaultCurrency: "RON", defaultPaymentTermDays: 15,
  vatConfigurations: [{ code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" }], branding,
})

void test("updates tenant customers and manages hard-deleted product presets", async () => {
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

void test("configures normalized issuer branding, removes it, and authorizes before normalization", async () => {
  const state = emptyState()
  let normalizations = 0
  const normalizer = { normalize: () => Effect.sync(() => {
    normalizations += 1
    return { pngBase64: "iVBORw0KGgo=", width: 16, height: 8 }
  }) }
  const service = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-1" } }), clock: fixedClock,
    ids: sequentialIds(), store: memoryStore(state), branding: normalizer, cubeIdentity: "invoicing",
  })
  const text = await Effect.runPromise(service.configureIssuer(issuerInput({ text: "  Siglă companie  ", image: null })))
  assert.deepEqual(text.branding, { text: "Siglă companie", image: null })
  const image = await Effect.runPromise(service.configureIssuer(issuerInput({ text: null, image: { dataBase64: "iVBORw0KGgo=" } })))
  assert.deepEqual(image.branding, { text: null, image: { pngBase64: "iVBORw0KGgo=", width: 16, height: 8 } })
  const both = await Effect.runPromise(service.configureIssuer(issuerInput({ text: "Marcă", image: { dataBase64: "iVBORw0KGgo=" } })))
  assert.equal(both.branding?.text, "Marcă")
  assert.equal(normalizations, 2)
  assert.equal((await Effect.runPromise(service.configureIssuer(issuerInput(null)))).branding, null)
  assert.equal((await Effect.runPromise(service.getIssuer())).branding, null)

  for (const branding of [
    { text: null, image: null },
    { text: "x\u0000", image: null },
    { text: "x".repeat(81), image: null },
    { text: null, image: { dataBase64: "not-base64" } },
    { text: null, image: { dataBase64: "AB==" } },
  ]) {
    assert.equal(await Effect.runPromise(Effect.flip(service.configureIssuer(issuerInput(branding)))) instanceof ValidationFailure, true)
  }
  assert.equal(normalizations, 2)
  assert.equal(await Effect.runPromise(Effect.flip(service.configureIssuer({ ...issuerInput({
    text: null, image: { dataBase64: "iVBORw0KGgo=" },
  }), defaultCurrency: "EUR" }))) instanceof ValidationFailure, true)
  assert.equal(normalizations, 2)

  const denied = createInvoicingService({
    context: contextProvider({ identity: { ...identity, permissions: [] }, organization: { id: "org-1" } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), branding: normalizer, cubeIdentity: "invoicing",
  })
  assert.equal(await Effect.runPromise(Effect.flip(denied.configureIssuer(issuerInput({
    text: null, image: { dataBase64: "iVBORw0KGgo=" },
  })))) instanceof PermissionDenied, true)
  assert.equal(normalizations, 2)
})
