import assert from "node:assert/strict"
import test from "node:test"

import { authoringAccess } from "./invoice-authoring-readiness.ts"
import { authoringPayloadMatchesDraft } from "./invoice-authoring-payload.ts"
import { draftDeletionState, invoiceDueDateIssue } from "./invoice-authoring-workflow.ts"
import { DERIVED_DRAFT_DELETE_REFUSED } from "./draft-save-types.ts"
import { authoringSeriesOptions } from "./document-authoring-options.ts"
import { documentNotesIssue, documentNotesMaxLength } from "./invoice-notes-validation.ts"
import { positiveInvoiceRequiresDueDate } from "./invoice-positive-total.ts"
import { formFromDraft } from "./document-authoring-transitions.ts"
import { defaultVatCode, issuerVatRegistrationOn, presetVatCode, vatRatesForIssuer } from "./vat-defaults.ts"
import { hasStaleDraftTax, staleDraftLineIds } from "./vat-snapshots.ts"
import type { DraftInvoice, Issuer, VatCatalogue, VatConfiguration, VatRate } from "./draft-models.ts"
import type { InvoiceAuthoringForm } from "./invoice-authoring-model.ts"

const unit = { code: "C62", name: "unitate" }

const catalogue = (): VatCatalogue => ({
  rates: [
    { code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null, kind: "standard", label: "TVA 21%", effectiveFrom: "2026-01-01" },
    { code: "RO_REDUCED", rate: "9.00", vatCategoryCode: "S", vatExemptionReason: null, kind: "reduced", label: "TVA 9%", effectiveFrom: "2026-01-01" },
    { code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "O", vatExemptionReason: "Regim special de scutire conform art. 310 din Codul fiscal", kind: "non_vat", label: "Scutit", effectiveFrom: "2026-01-01" },
  ],
})

const configuration = (code: string, rate: string, vatCategoryCode: "S" | "O", from: string, to?: string): VatConfiguration => ({
  code, rate, vatCategoryCode,
  vatExemptionReason: vatCategoryCode === "O" ? "Regim special de scutire conform art. 310 din Codul fiscal" : null,
  effectiveFrom: from, ...(to === undefined ? {} : { effectiveTo: to }),
})

const issuer = (configurations: ReadonlyArray<VatConfiguration>): Issuer => ({
  organizationId: "org", name: "Beta", fiscalIdentifier: "321",
  address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 },
  legalForm: "srl", tradeRegistryNumber: "J40/1/2020", iban: "RO00XXXX0000000000", bankName: "Banca",
  socialCapital: "100.00", defaultCurrency: "RON", defaultPaymentTermDays: 14,
  vatConfigurations: configurations, currentVat: null, branding: null,
})

const draftLine = (vatRateCode: string, vatRate: string, id: string): DraftInvoice["lines"][number] => ({
  id, description: "Consultanță", quantity: "1", unitPrice: "100.00", unitOfMeasure: unit,
  vatRateCode, vatRate, vatCategoryCode: vatRate === "0.00" ? "O" : "S",
  vatExemptionReason: vatRate === "0.00" ? "Regim special de scutire conform art. 310 din Codul fiscal" : null,
  totalExcludingVat: "100.00", vatAmount: "0.00", totalIncludingVat: "100.00",
})

const draftOf = (patch: Partial<DraftInvoice> = {}): DraftInvoice => ({
  id: "draft-1", organizationId: "org",
  customer: { partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false,
    address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 } },
  sourceProformaId: null, series: "FCT", issueDate: "2026-01-01", dueDate: null, currency: "RON",
  notes: null, status: "draft", lines: [draftLine("RO_STANDARD", "21.00", "line-1")],
  vatBreakdown: [], totalExcludingVat: "100.00", vatTotal: "0.00", totalIncludingVat: "100.00",
  ...patch,
})

const payloadLine = { description: "Consultanță", quantity: "1", unitPrice: "100.00", unitOfMeasure: unit, vatRateCode: "RO_STANDARD" }

const payloadOf = (patch: {
  readonly issueDate?: string
  readonly dueDate?: string | null
  readonly notes?: string | null
  readonly lines?: ReadonlyArray<DraftInvoice["lines"][number] extends never ? never : Parameters<typeof authoringPayloadMatchesDraft>[0]["lines"][number]>
} = {}): Parameters<typeof authoringPayloadMatchesDraft>[0] => ({
  customer: { partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false,
    address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 } },
  series: "FCT", issueDate: "2026-01-01", currency: "RON", dueDate: null, notes: null,
  lines: [payloadLine],
  ...patch,
})

void test("a due date is required only when the fiscal total rounds positive", () => {
  // 0.006 × 1.00 rotunjit half-up la cenți = 0.01: pozitiv; 0.004 × 1.00 = 0.00: zero.
  assert.equal(positiveInvoiceRequiresDueDate(null, undefined, [{ quantity: "0.006", unitPrice: "1.00" }]), true)
  assert.equal(positiveInvoiceRequiresDueDate(null, undefined, [{ quantity: "0.004", unitPrice: "1.00" }]), false)
  assert.equal(positiveInvoiceRequiresDueDate(null, "100.00", []), true)
  assert.equal(positiveInvoiceRequiresDueDate(null, "0.00", []), false)
  assert.equal(positiveInvoiceRequiresDueDate("", "100.00", []), true)
  assert.equal(positiveInvoiceRequiresDueDate("2026-02-01", "100.00", []), false)
})

void test("the issuance comparison catches a concurrent change on any sealed field", () => {
  const draft = draftOf()
  assert.equal(authoringPayloadMatchesDraft(payloadOf(), draft), true)
  assert.equal(authoringPayloadMatchesDraft(payloadOf({ issueDate: "2026-03-03" }), draft), false)
  assert.equal(authoringPayloadMatchesDraft(payloadOf({ dueDate: "2026-02-01" }), draft), false)
  assert.equal(authoringPayloadMatchesDraft(payloadOf({ notes: "nou" }), draft), false)
  assert.equal(authoringPayloadMatchesDraft(
    payloadOf({ lines: [{ ...payloadLine, unitPrice: "999.00" }] }), draft), false)
  const savedCustomerPayload: Parameters<typeof authoringPayloadMatchesDraft>[0] = {
    customerId: "client-1", series: "FCT", issueDate: "2026-01-01", currency: "RON",
    dueDate: null, notes: null, lines: [payloadLine],
  }
  assert.equal(authoringPayloadMatchesDraft(savedCustomerPayload, draftOf({ customerId: "client-1" })), true)
})

void test("a form rebuilt from a draft matches that draft's header", async () => {
  const { headerMatchesDraft } = await import("./invoice-authoring-readiness.ts")
  const draft = draftOf({ notes: "notă", dueDate: "2026-02-01" })
  const form: InvoiceAuthoringForm = formFromDraft(draft)
  assert.equal(headerMatchesDraft({ ...form, notes: "notă" }, draft), true)
  assert.equal(headerMatchesDraft({ ...form, notes: "alta" }, draft), false)
})

void test("a locked draft points at the registry it belongs to, not always at the invoices one", () => {
  assert.equal(authoringAccess("draft").editable, true)
  const issued = authoringAccess("issued")
  assert.equal(issued.editable, false)
  assert.equal(issued.registryHref, "/invoices")
  const proforma = authoringAccess("proforma_issued")
  assert.equal(proforma.editable, false)
  // The document is a proforma: sending the user to the invoice register would
  // be sending them to a list it is not in.
  assert.equal(proforma.registryHref, "/proformas")
  assert.match(proforma.registryLabel, /proforme/)
  assert.ok(!proforma.notice.includes("aplicația existentă"))
})

void test("a derived draft cannot be deleted, but stays editable and issuable", () => {
  assert.equal(draftDeletionState(undefined).kind, "hidden")
  assert.equal(draftDeletionState(draftOf()).kind, "available")
  const derived = draftDeletionState(draftOf({ sourceProformaId: "prof 1" }))
  assert.equal(derived.kind, "derived")
  assert.ok(derived.notice.message.includes("Nu poate fi șters"))
  // The notice names the proforma that owns it, and the id is encoded once.
  assert.equal(derived.notice.proformaHref, "/proformas/prof%201")
  assert.ok(!derived.notice.message.includes("aplicația existentă"))
})

void test("the refusal to delete a derived draft names the source proforma", () => {
  assert.ok(DERIVED_DRAFT_DELETE_REFUSED.includes("proforma sursă"))
  assert.ok(!DERIVED_DRAFT_DELETE_REFUSED.includes("aplicația existentă"))
})

void test("a screen offers the series of the document it authors, never the other family's", () => {
  const series = [
    { documentType: "invoice", series: "FCT" },
    { documentType: "proforma", series: "PRO" },
    { documentType: "invoice", series: "FCT2" },
  ] as const
  assert.deepEqual(authoringSeriesOptions(series, "invoice"), ["FCT", "FCT2"])
  assert.deepEqual(authoringSeriesOptions(series, "proforma"), ["PRO"])
  assert.deepEqual(authoringSeriesOptions([], "proforma"), [])
})

void test("notes validation mirrors the server rules", () => {
  assert.equal(documentNotesIssue("text simplu"), null)
  assert.ok(documentNotesIssue("tab\taici") !== null)
  assert.ok(documentNotesIssue("a".repeat(documentNotesMaxLength + 1)) !== null)
})

void test("the effective VAT rates follow the issuer's registrations on the document date", () => {
  const registered = issuer([configuration("RO_STANDARD", "21.00", "S", "2026-01-01")])
  const nonVat = issuer([configuration("RO_NON_VAT", "0.00", "O", "2026-01-01")])
  const switching = issuer([
    configuration("RO_STANDARD", "21.00", "S", "2026-01-01", "2026-06-30"),
    configuration("RO_NON_VAT", "0.00", "O", "2026-07-01"),
  ])
  assert.equal(issuerVatRegistrationOn(registered, "2026-05-05"), true)
  assert.equal(issuerVatRegistrationOn(nonVat, "2026-05-05"), false)
  const taxes = vatRatesForIssuer(catalogue(), switching, "2026-08-08")
  assert.deepEqual(taxes.map((rate: VatRate) => rate.code), ["RO_NON_VAT"])
  assert.equal(defaultVatCode(catalogue(), switching, "2026-05-05"), "RO_STANDARD")
  // A product's preferred rate wins only while the issuer can charge it.
  assert.equal(presetVatCode("RO_REDUCED", catalogue(), switching, "2026-05-05"), "RO_REDUCED")
  assert.equal(presetVatCode("RO_REDUCED", catalogue(), switching, "2026-08-08"), "RO_NON_VAT")
})

void test("lines saved under a rate the issuer can no longer charge are stale until re-saved", () => {
  const switching = issuer([
    configuration("RO_STANDARD", "21.00", "S", "2026-01-01", "2026-06-30"),
    configuration("RO_NON_VAT", "0.00", "O", "2026-07-01"),
  ])
  const draft = draftOf({
    issueDate: "2026-08-08",
    lines: [draftLine("RO_STANDARD", "21.00", "line-1"), draftLine("RO_NON_VAT", "0.00", "line-2")],
  })
  assert.equal(hasStaleDraftTax(draft.issueDate, draft.lines, catalogue(), switching), true)
  assert.deepEqual(staleDraftLineIds(draft.issueDate, draft.lines, catalogue(), switching), ["line-1"])
  const sameDate = draftOf({ issueDate: "2026-05-05", lines: [draftLine("RO_STANDARD", "21.00", "line-1")] })
  assert.equal(hasStaleDraftTax(sameDate.issueDate, sameDate.lines, catalogue(), switching), false)
})

void test("the due-date issue names the requirement without blocking a draft save", () => {
  assert.equal(invoiceDueDateIssue(true), "Data scadenței este obligatorie pentru o factură cu total pozitiv.")
  assert.equal(invoiceDueDateIssue(false), null)
})
