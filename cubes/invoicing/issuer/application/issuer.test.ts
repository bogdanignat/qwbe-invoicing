import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { brandingNormalizer, contextProvider, emptyState, fixedClock, identity, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"
import { DomainConflict, ValidationFailure } from "../../contracts/index.ts"
import { PermissionDenied, ResourceNotFound } from "../../contracts/failures.ts"
import type { ConfigureIssuerInput, VatChange } from "../domain/issuer.ts"

const vatChange = (registered: boolean, effectiveFrom: string): VatChange => registered
  ? { registered: true, effectiveFrom }
  : { registered: false, effectiveFrom, nonVatBasis: "article_310" }
const issuerInput = (branding: Parameters<ReturnType<typeof createInvoicingService>["configureIssuer"]>[0]["branding"]): ConfigureIssuerInput => ({
  name: "Exemplu SRL", fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1", county: "RO-BT" },
  legalForm: "srl" as const, tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", iban: "", bankName: "",
  defaultCurrency: "RON", defaultPaymentTermDays: 15,
  vatChange: vatChange(true, "2025-08-01"), branding,
})

void test("issuer reads, writes and audit stay scoped to the authorized organization", async () => {
  const state = emptyState()
  const ids = sequentialIds()
  const serviceFor = (id: string, permissions = identity.permissions) => createInvoicingService({
    context: contextProvider({ identity: { ...identity, permissions }, organization: { id } }),
    clock: fixedClock, ids, store: memoryStore(state), branding: brandingNormalizer, cubeIdentity: "invoicing",
  })
  const first = serviceFor("org-1")
  const second = serviceFor("org-2")
  await Effect.runPromise(first.configureIssuer(issuerInput(null)))
  assert.ok(await Effect.runPromise(Effect.flip(second.getIssuer())) instanceof ResourceNotFound)
  await Effect.runPromise(second.configureIssuer({ ...issuerInput(null), name: "Alt emitent SRL" }))
  assert.equal((await Effect.runPromise(first.getIssuer())).name, "Exemplu SRL")
  assert.equal((await Effect.runPromise(second.getIssuer())).name, "Alt emitent SRL")
  assert.deepEqual(state.auditEvents.map(({ organizationId }) => organizationId), ["org-1", "org-2"])

  const before = structuredClone(state)
  const denied = serviceFor("org-1", [])
  assert.ok(await Effect.runPromise(Effect.flip(denied.getIssuer())) instanceof PermissionDenied)
  assert.ok(await Effect.runPromise(Effect.flip(denied.getVatCatalogue())) instanceof PermissionDenied)
  assert.ok(await Effect.runPromise(Effect.flip(denied.configureIssuer(issuerInput(null)))) instanceof PermissionDenied)
  assert.deepEqual(state, before)
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

  assert.deepEqual(state.auditEvents.map(({ action, actorId, targetKind, targetId }) => ({ action, actorId, targetKind, targetId })), [
    ...Array.from({ length: 4 }, () => ({ action: "issuer.configured", actorId: identity.id, targetKind: "issuer", targetId: "org-1" })),
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
  assert.equal(state.auditEvents.length, 4)
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

void test("schedules future VAT transitions with a canonical CUI independent of registration", async () => {
  for (const registered of [true, false]) {
    const state = emptyState()
    let now = new Date("2026-09-12T12:00:00.000Z")
    const service = createInvoicingService({
      context: contextProvider({ identity, organization: { id: "org-1" } }),
      clock: { now: Effect.sync(() => now) }, ids: sequentialIds(), store: memoryStore(state),
      branding: brandingNormalizer, cubeIdentity: "invoicing",
    })
    const input = { ...issuerInput(null), fiscalIdentifier: "12345674",
      vatChange: vatChange(registered, "2026-01-01") }
    await Effect.runPromise(service.configureIssuer(input))
    const scheduled = await Effect.runPromise(service.configureIssuer({ ...input,
      vatChange: vatChange(!registered, "2027-01-01") }))
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
