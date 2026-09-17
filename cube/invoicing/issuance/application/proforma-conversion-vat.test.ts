import assert from "node:assert/strict"
import test from "node:test"
import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { brandingNormalizer, contextProvider, each, emptyState, identity, idempotent, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"
import { ResourceNotFound, ValidationFailure } from "../../contracts/failures.ts"
import type { ConfigureIssuerInput, VatChange } from "../../domain/inputs.ts"

const vatChange = (registered: boolean, effectiveFrom: string): VatChange => registered
  ? { registered: true, effectiveFrom }
  : { registered: false, effectiveFrom, nonVatBasis: "article_310" }

const issuer: ConfigureIssuerInput = {
  name: "Emitent SRL", fiscalIdentifier: "12345674", address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" },
  legalForm: "srl", tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", iban: "", bankName: "",
  branding: { text: "Brand proformă", image: null }, defaultCurrency: "RON", defaultPaymentTermDays: 15,
  vatChange: { registered: true, effectiveFrom: "2025-01-01" },
}

const setup = async (registered = true, date = "2026-09-01") => {
  const state = emptyState()
  let now = new Date(`${date}T10:00:00.000Z`)
  const service = createInvoicingService({ context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: { now: Effect.sync(() => now) }, ids: sequentialIds(), store: memoryStore(state), branding: brandingNormalizer, cubeIdentity: "invoicing" })
  await Effect.runPromise(service.configureIssuer({ ...issuer, fiscalIdentifier: "12345674",
    vatChange: vatChange(registered, issuer.vatChange.effectiveFrom) }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "INV" }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
  const proforma = await Effect.runPromise(service.issueProforma(idempotent({ proformaSeries: "PRO", issueDate: date, dueDate: date,
    currency: "RON", customer: { partyType: "individual", name: "Client", fiscalIdentifier: "", vatRegistered: false, address: issuer.address },
    lines: [{ description: "Serviciu", quantity: "1", unitPrice: "100", unitOfMeasure: each,
      vatRateCode: registered ? "RO_STANDARD" : "RO_NON_VAT" }] })))
  const conversion = idempotent({ proformaId: proforma.id, invoiceSeries: "INV" })
  return { state, service, proforma, conversion, setDate: (value: string) => { now = new Date(`${value}T10:00:00.000Z`) } }
}

for (const registered of [false, true]) {
  void test(`direct conversion rejects ${registered ? "VAT to non-VAT" : "non-VAT to VAT"} changes without side effects`, async () => {
    const { state, service, proforma, conversion, setDate } = await setup(registered)
    setDate("2026-09-02")
    await Effect.runPromise(service.configureIssuer({ ...issuer, fiscalIdentifier: "12345674",
      vatChange: vatChange(!registered, "2026-09-02") }))
    const before = structuredClone(state)
    const result = await Effect.runPromise(Effect.either(service.issueInvoiceFromProforma(conversion)))
    assert.equal(result._tag, "Left")
    assert.ok(result.left instanceof ValidationFailure)
    assert.ok(result.left.issues.some((issue) => issue.includes("2026-09-02")))
    assert.deepEqual(state, before)
    assert.equal((await Effect.runPromise(service.getProforma(proforma.id))).convertedInvoiceId, null)
  })
}

void test("direct conversion rejects a proforma's 19% lines after the legal rate changed", async () => {
  const { state, service, proforma, conversion, setDate } = await setup(true, "2025-07-15")
  assert.equal(proforma.lines[0]?.vatRate, "19.00")
  setDate("2025-08-05")
  const before = structuredClone(state)
  const result = await Effect.runPromise(Effect.either(service.issueInvoiceFromProforma(conversion)))
  assert.equal(result._tag, "Left")
  assert.ok(result.left instanceof ValidationFailure)
  assert.ok(result.left.issues.includes("VAT pair RO_STANDARD/19.00 is not supported on 2025-08-05"))
  assert.deepEqual(state, before)
})

for (const missing of ["issuer", "registration"] as const) {
  void test(`direct conversion refuses missing ${missing} without writes`, async () => {
    const { state, service, conversion } = await setup()
    const profile = state.issuers.get("org-1")
    assert.ok(profile)
    // Deliberate invalid store fixture: the configuration API always supplies a VAT registration.
    if (missing === "issuer") state.issuers.delete("org-1")
    else state.issuers.set("org-1", { ...profile, vatConfigurations: [] })
    const before = structuredClone(state)
    const result = await Effect.runPromise(Effect.either(service.issueInvoiceFromProforma(conversion)))
    assert.equal(result._tag, "Left")
    assert.ok(missing === "issuer" ? result.left instanceof ResourceNotFound : result.left instanceof ValidationFailure)
    assert.deepEqual(state, before)
  })
}

void test("direct conversion refuses a discordant frozen VAT flag even when its lines are valid", async () => {
  const { state, service, proforma, conversion } = await setup()
  // Simulates a corrupt adapter snapshot; normal authoring produces a concordant flag.
  state.proformas.set(proforma.id, { ...proforma, issuer: { ...proforma.issuer, vatRegistered: false } })
  const before = structuredClone(state)
  const result = await Effect.runPromise(Effect.either(service.issueInvoiceFromProforma(conversion)))
  assert.equal(result._tag, "Left")
  assert.ok(result.left instanceof ValidationFailure)
  assert.ok(result.left.issues.includes("issuer VAT registration changed since the proforma was issued"))
  assert.deepEqual(state, before)
})

void test("valid conversion keeps the source issuer and replays after a later VAT change", async () => {
  const { state, service, proforma, conversion, setDate } = await setup()
  setDate("2026-09-02")
  await Effect.runPromise(service.configureIssuer({ ...issuer, name: "Nume nou", branding: null }))
  const invoice = await Effect.runPromise(service.issueInvoiceFromProforma(conversion))
  assert.equal(invoice.issueDate, "2026-09-02")
  assert.deepEqual(invoice.issuer, proforma.issuer)
  assert.deepEqual(invoice.lines, proforma.lines)
  assert.equal(invoice.totalIncludingVat, proforma.totalIncludingVat)
  setDate("2026-09-03")
  await Effect.runPromise(service.configureIssuer({ ...issuer, fiscalIdentifier: "12345674",
    vatChange: vatChange(false, "2026-09-03") }))
  const before = structuredClone(state)
  assert.deepEqual(await Effect.runPromise(service.issueInvoiceFromProforma(conversion)), invoice)
  assert.deepEqual(state, before)
})

void test("copies an old valid proforma to a draft but gates issuance until its VAT treatment is edited", async () => {
  const { service, proforma, conversion, setDate } = await setup(true)
  setDate("2026-09-02")
  await Effect.runPromise(service.configureIssuer({ ...issuer, vatChange: vatChange(false, "2026-09-02") }))
  const draft = await Effect.runPromise(service.createDraftInvoiceFromProforma(conversion))
  assert.deepEqual(draft.lines, proforma.lines.map((line, index) => ({ ...line, id: draft.lines[index]?.id })))
  assert.ok(await Effect.runPromise(Effect.flip(service.issueInvoice(idempotent({ draftId: draft.id })))) instanceof ValidationFailure)
  const line = draft.lines[0]
  assert.ok(line)
  await Effect.runPromise(service.updateDraftLine({ draftId: draft.id, lineId: line.id, description: line.description,
    quantity: line.quantity, unitPrice: line.unitPrice, unitOfMeasure: line.unitOfMeasure, vatRateCode: "RO_NON_VAT" }))
  const invoice = await Effect.runPromise(service.issueInvoice(idempotent({ draftId: draft.id })))
  assert.equal(invoice.lines[0]?.vatCategoryCode, "O")
})

void test("rejects a source with only its breakdown corrupted on both conversion paths", async () => {
  const { state, service, proforma, conversion } = await setup()
  state.proformas.set(proforma.id, { ...proforma,
    vatBreakdown: proforma.vatBreakdown.map((item) => ({ ...item, vatBaseAmount: "99.99" })) })
  const before = structuredClone(state)
  assert.ok(await Effect.runPromise(Effect.flip(service.issueInvoiceFromProforma(conversion))) instanceof ValidationFailure)
  assert.deepEqual(state, before)
  assert.ok(await Effect.runPromise(Effect.flip(service.createDraftInvoiceFromProforma(conversion))) instanceof ValidationFailure)
  assert.deepEqual(state, before)
})
