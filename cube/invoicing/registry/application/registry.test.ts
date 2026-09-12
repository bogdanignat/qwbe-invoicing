import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { brandingNormalizer, contextProvider, each, emptyState, fixedClock, identity, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"
import { DomainConflict, ResourceNotFound, ValidationFailure } from "../../contracts/index.ts"
import { PermissionDenied } from "../../contracts/failures.ts"

const issuerInput = (branding: Parameters<ReturnType<typeof createInvoicingService>["configureIssuer"]>[0]["branding"]) => ({
  name: "Exemplu SRL", fiscalIdentifier: "RO12345674",
  address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
  legalForm: "srl" as const, tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", iban: "", bankName: "",
  defaultCurrency: "RON", defaultPaymentTermDays: 15,
  vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding,
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
  assert.deepEqual((await Effect.runPromise(service.getIssuer())).currentVat,
    { registered: true, effectiveFrom: "2025-08-01" })

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

  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
  assert.deepEqual(state.auditEvents.map(({ action, actorId, targetKind, targetId }) => ({ action, actorId, targetKind, targetId })), [
    ...Array.from({ length: 4 }, () => ({ action: "issuer.configured", actorId: identity.id, targetKind: "issuer", targetId: "org-1" })),
    { action: "series.added", actorId: identity.id, targetKind: "document_series", targetId: "invoice:QWBE" },
  ])
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
  assert.equal(state.auditEvents.length, 5)
})

void test("rolls issuer configuration back when its audit append fails", async () => {
  const state = emptyState()
  const baseStore = memoryStore(state)
  const service = createInvoicingService({ context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: fixedClock, ids: sequentialIds(), store: baseStore, branding: brandingNormalizer, cubeIdentity: "invoicing" })
  const initial = await Effect.runPromise(service.configureIssuer(issuerInput(null)))
  const auditBaseline = state.auditEvents.length
  const failing = createInvoicingService({ context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: fixedClock, ids: sequentialIds(), branding: brandingNormalizer, cubeIdentity: "invoicing", store: {
      transaction: (use) => baseStore.transaction((transaction) => use({ ...transaction,
        appendAuditEvent: () => Effect.fail(new DomainConflict({ code: "forced_audit_failure", message: "forced" })) })),
    } })
  const failure = await Effect.runPromise(Effect.flip(failing.configureIssuer({ ...issuerInput(null), name: "Changed SRL" })))
  assert.equal(failure instanceof DomainConflict && failure.code === "forced_audit_failure", true)
  assert.deepEqual(await Effect.runPromise(service.getIssuer()), initial)
  assert.equal(state.auditEvents.length, auditBaseline)
})

void test("schedules future VAT transitions without changing the current fiscal identifier", async () => {
  for (const registered of [true, false]) {
    const state = emptyState()
    let now = new Date("2026-09-12T12:00:00.000Z")
    const service = createInvoicingService({
      context: contextProvider({ identity, organization: { id: "org-1" } }),
      clock: { now: Effect.sync(() => now) }, ids: sequentialIds(), store: memoryStore(state),
      branding: brandingNormalizer, cubeIdentity: "invoicing",
    })
    const input = { ...issuerInput(null), fiscalIdentifier: registered ? "RO12345674" : "12345674",
      vatChange: { registered, effectiveFrom: "2026-01-01" } }
    await Effect.runPromise(service.configureIssuer(input))
    const scheduled = await Effect.runPromise(service.configureIssuer({ ...input,
      vatChange: { registered: !registered, effectiveFrom: "2027-01-01" } }))
    assert.equal(scheduled.currentVat?.registered, registered)
    assert.equal(scheduled.fiscalIdentifier, input.fiscalIdentifier)
    const saved = await Effect.runPromise(service.configureIssuer({ ...input, name: "Updated company" }))
    assert.deepEqual(saved.vatConfigurations, scheduled.vatConfigurations)
    assert.equal((await Effect.runPromise(service.getIssuer())).name, "Updated company")
    // The registration becomes active at local midnight, not UTC midnight.
    now = new Date("2026-12-31T22:30:00.000Z")
    assert.equal((await Effect.runPromise(service.getIssuer())).currentVat?.registered, !registered)
    assert.equal((await Effect.runPromise(service.getIssuer())).fiscalIdentifier, input.fiscalIdentifier)
  }
})
