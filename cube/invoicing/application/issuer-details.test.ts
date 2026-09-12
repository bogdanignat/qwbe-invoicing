import assert from "node:assert/strict"
import test from "node:test"
import { Effect } from "effect"
import { ValidationFailure, type InvoicingFailure } from "../contracts/failures.ts"
import type { ConfigureIssuerInput } from "../domain/inputs.ts"
import { createInvoicingService } from "./invoicing.ts"
import { brandingNormalizer, contextProvider, each, emptyState, fixedClock, identity, idempotent, memoryStore, sequentialIds } from "./memory-store.test-support.ts"

const input: ConfigureIssuerInput = {
  name: "Emitent SRL", fiscalIdentifier: "RO12345674", address: { countryCode: "RO", city: "Iași", street: "Strada 1" },
  legalForm: "srl", tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", iban: "", bankName: "",
  branding: null, defaultCurrency: "RON", defaultPaymentTermDays: 15,
  vatChange: { registered: true, effectiveFrom: "2025-08-01" },
}
const document = {
  customer: { partyType: "individual" as const, name: "Client", fiscalIdentifier: "", address: input.address },
  series: "INV", issueDate: "2026-09-01", currency: "RON" as const,
  lines: [{ description: "Serviciu", quantity: "1", unitPrice: "10", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }],
}
const setup = async () => {
  const state = emptyState()
  const service = createInvoicingService({ context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), branding: brandingNormalizer, cubeIdentity: "invoicing" })
  await Effect.runPromise(service.configureIssuer(input))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "INV" }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
  return { state, service }
}

void test("issuer configuration normalizes all company fields exactly and accepts incomplete profiles", async () => {
  const { service } = await setup()
  const saved = await Effect.runPromise(service.configureIssuer({ ...input, tradeRegistryNumber: " j40/123/2020 ",
    socialCapital: "009007199254740993.1", iban: " ro49 aaaa 1b31 0075 9384 0000 ", bankName: " Bancă Știință " }))
  assert.equal(saved.legalForm, "srl")
  assert.equal(saved.tradeRegistryNumber, "J40/123/2020")
  assert.equal(saved.socialCapital, "9007199254740993.10")
  assert.equal(saved.iban, "RO49AAAA1B31007593840000")
  assert.equal(saved.bankName, "Bancă Știință")
  assert.deepEqual(await Effect.runPromise(service.getIssuer()), saved)
  const incomplete = await Effect.runPromise(service.configureIssuer({ ...input, tradeRegistryNumber: "", socialCapital: "" }))
  assert.equal(incomplete.tradeRegistryNumber, "")
  assert.equal(incomplete.socialCapital, "")
})

void test("invalid issuer details fail validation without overwriting the profile", async () => {
  const { state, service } = await setup()
  const before = structuredClone(state.issuers)
  for (const patch of [
    { legalForm: "sa" }, { legalForm: undefined }, { tradeRegistryNumber: "invalid" }, { tradeRegistryNumber: "J40/1/2020\u0000" },
    { socialCapital: "1.001" }, { socialCapital: "-1" }, { socialCapital: "1e3" }, { socialCapital: "9".repeat(19) },
    { iban: "RO48AAAA1B31007593840000" }, { bankName: "Bank\u200bName" }, { bankName: "x".repeat(121) },
  ]) {
    const result = await Effect.runPromise(Effect.either(service.configureIssuer({ ...input, ...patch } as ConfigureIssuerInput)))
    assert.equal(result._tag, "Left", JSON.stringify(patch))
    assert.ok(result.left instanceof ValidationFailure)
    assert.deepEqual(state.issuers, before)
  }
})

void test("all direct and draft issuance routes refuse incomplete SRL/PFA without consuming numbers or idempotency", async () => {
  for (const patch of [{ socialCapital: "" }, { tradeRegistryNumber: "" }, { legalForm: "pfa" as const, tradeRegistryNumber: "", socialCapital: "" }]) {
    const { service, state } = await setup()
    const draft = await Effect.runPromise(service.createDraft(document))
    const line = document.lines[0]
    assert.ok(line)
    await Effect.runPromise(service.addDraftLine({ draftId: draft.id, ...line }))
    await Effect.runPromise(service.configureIssuer({ ...input, ...patch }))
    const operations: Effect.Effect<unknown, InvoicingFailure>[] = [service.issueInvoice(idempotent(document)), service.issueInvoice(idempotent({ draftId: draft.id })),
      service.issueProforma(idempotent({ ...document, proformaSeries: "PRO" })), service.issueProforma(idempotent({ draftId: draft.id, series: "PRO" }))]
    for (const operation of operations) {
      const result = await Effect.runPromise(Effect.either(operation))
      assert.equal(result._tag, "Left")
      assert.ok(result.left instanceof ValidationFailure)
    }
    assert.equal(state.sequences.size, 0)
    assert.equal(state.idempotency.size, 0)
    assert.equal(state.issued.size, 0)
    assert.equal(state.proformas.size, 0)
    assert.equal(state.drafts.get(draft.id)?.status, "draft")
  }
})

void test("PFA issues without capital; conversion, correction, summaries and replay preserve their source issuer", async () => {
  const { service } = await setup()
  await Effect.runPromise(service.configureIssuer({ ...input, legalForm: "pfa", tradeRegistryNumber: "F40/123/2020", socialCapital: "" }))
  const proforma = await Effect.runPromise(service.issueProforma(idempotent({ ...document, proformaSeries: "PRO" })))
  assert.equal(proforma.issuer.legalForm, "pfa")
  assert.equal(proforma.issuer.socialCapital, "")
  await Effect.runPromise(service.configureIssuer({ ...input, tradeRegistryNumber: "", socialCapital: "" }))
  const request = idempotent({ proformaId: proforma.id })
  const invoice = await Effect.runPromise(service.issueInvoiceFromProforma(request))
  assert.deepEqual(invoice.issuer, proforma.issuer)
  assert.deepEqual(await Effect.runPromise(service.issueInvoiceFromProforma(request)), invoice)
  const correction = await Effect.runPromise(service.createCorrection(idempotent({ originalInvoiceId: invoice.id, reason: "Test" })))
  const { branding, ...company } = proforma.issuer
  assert.equal(branding, null)
  assert.deepEqual(correction.issuer, company)
  assert.deepEqual((await Effect.runPromise(service.listIssuedInvoices())).items[0]?.issuer, company)
  assert.deepEqual((await Effect.runPromise(service.listProformas())).items[0]?.issuer, company)
})
