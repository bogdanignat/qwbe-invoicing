import assert from "node:assert/strict"
import test from "node:test"

import {
  CONVERSION_DUE_DATE_ISSUE, conversionRefusal, effectiveInvoiceSeries, proformaConversionAvailability,
  proformaConversionOutcome, proformaConversionOutcomeOf, proformaConversionSummary,
} from "./proforma-conversion.ts"
import type { Proforma } from "./proforma-models.ts"

const proforma: Proforma = {
  id: "prf-1", series: "PRO", number: 7, issueDate: "2026-02-01", dueDate: "2026-02-15",
  currency: "RON", notes: null, sourceDraftId: null, convertedInvoiceId: null, convertedDraftId: null,
  issuer: {
    name: "Qwbe Software SRL", fiscalIdentifier: "12345674", legalForm: "srl",
    tradeRegistryNumber: "J40/1234/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca Transilvania",
    socialCapital: "200.00", vatRegistered: true,
    address: { countryCode: "RO", city: "București", street: "Str. Lungă 1", county: "RO-B", sector: 3 },
  },
  customer: {
    partyType: "company", name: "Alfa SRL", fiscalIdentifier: "87654329", vatRegistered: true,
    address: { countryCode: "RO", city: "Cluj-Napoca", street: "Str. Scurtă 2", county: "RO-CJ" },
  },
  lines: [{
    id: "line-1", description: "Avans", quantity: "2", unitPrice: "500.00",
    unitOfMeasure: { code: "H87", name: "bucată" }, vatRateCode: "RO_STANDARD", vatRate: "21.00",
    vatCategoryCode: "S", vatExemptionReason: null,
    totalExcludingVat: "1000.00", vatAmount: "210.00", totalIncludingVat: "1210.00",
  }],
  vatBreakdown: [{
    code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null,
    vatBaseAmount: "1000.00", vatAmount: "210.00",
  }],
  totalExcludingVat: "1000.00", vatTotal: "210.00", totalIncludingVat: "1210.00",
}

const open = { proforma, selectedSeries: "FCT", pending: false, blocked: false }

void test("an unconverted proforma offers both conversions once a series is chosen", () => {
  const availability = proformaConversionAvailability(open)

  assert.equal(availability.outcome.kind, "available")
  assert.equal(availability.canIssueInvoice, true)
  assert.equal(availability.canCreateDraft, true)
  assert.equal(availability.dueDateIssue, null)
})

void test("nothing is offered without a series, while a request is in flight, or while a write is blocked", () => {
  assert.equal(proformaConversionAvailability({ ...open, selectedSeries: "" }).canCreateDraft, false)
  assert.equal(proformaConversionAvailability({ ...open, selectedSeries: "" }).canIssueInvoice, false)
  assert.equal(proformaConversionAvailability({ ...open, pending: true }).canCreateDraft, false)
  assert.equal(proformaConversionAvailability({ ...open, blocked: true }).canIssueInvoice, false)
})

/**
 * The rule ported from the legacy screen: the invoice takes today's date and this
 * proforma's terms, so a positive total with no due date cannot be issued. The
 * draft route stays open precisely because that is where the date is filled in.
 */
void test("a positive total without a due date closes issuance and keeps the draft open", () => {
  const availability = proformaConversionAvailability({ ...open, proforma: { ...proforma, dueDate: null } })

  assert.equal(availability.canIssueInvoice, false)
  assert.equal(availability.canCreateDraft, true)
  assert.equal(availability.dueDateIssue, CONVERSION_DUE_DATE_ISSUE)
})

void test("a zero total without a due date is issuable: the rule is about money owed, not about dates", () => {
  const free = { ...proforma, dueDate: null, totalIncludingVat: "0.00" }
  const availability = proformaConversionAvailability({ ...open, proforma: free })

  assert.equal(availability.canIssueInvoice, true)
  assert.equal(availability.dueDateIssue, null)
})

/**
 * The same rule as a function of the document alone, which is the form the
 * controller applies to every request: the buttons above are derived from it,
 * not the other way round.
 */
void test("the refusal is about the invoice a positive proforma without a due date would become", () => {
  const terms = { dueDate: null, totalIncludingVat: "1210.00" }

  assert.equal(conversionRefusal({ ...terms, target: "invoice" }), CONVERSION_DUE_DATE_ISSUE)
  assert.equal(conversionRefusal({ ...terms, target: "draft" }), undefined)
  assert.equal(conversionRefusal({ ...terms, target: "invoice", dueDate: "2026-02-15" }), undefined)
  assert.equal(conversionRefusal({ ...terms, target: "invoice", totalIncludingVat: "0.00" }), undefined)
})

void test("a converted proforma offers a link instead of buttons, with the badge the registry shows", () => {
  const invoiced = proformaConversionOutcome({ convertedInvoiceId: "inv-9", convertedDraftId: null })
  const drafted = proformaConversionOutcome({ convertedInvoiceId: null, convertedDraftId: "draft/9" })

  assert.deepEqual(invoiced, {
    kind: "invoice", href: "/invoices/inv-9", label: "Deschide factura emisă",
    status: { label: "Facturată", tone: "positive" },
  })
  assert.deepEqual(drafted, {
    kind: "draft", href: "/drafts/draft%2F9", label: "Deschide draftul creat anterior",
    status: { label: "Draft factură creat", tone: "info" },
  })
  // Both ids set: the invoice is the later fact, so it is the one linked.
  assert.equal(proformaConversionOutcome({ convertedInvoiceId: "inv-9", convertedDraftId: "draft-9" }).kind, "invoice")
})

void test("a converted proforma allows no new conversion, whatever is selected", () => {
  const availability = proformaConversionAvailability({
    ...open, proforma: { ...proforma, dueDate: null, convertedDraftId: "draft-9" },
  })

  assert.equal(availability.canIssueInvoice, false)
  assert.equal(availability.canCreateDraft, false)
  // The note belongs to a decision still to be made: there is none left here.
  assert.equal(availability.dueDateIssue, null)
})

void test("a document that has not arrived is unknown, not convertible", () => {
  const availability = proformaConversionAvailability({ ...open, proforma: undefined })

  assert.deepEqual(availability.outcome, { kind: "unknown" })
  assert.equal(availability.canCreateDraft, false)
  assert.deepEqual(proformaConversionOutcomeOf(undefined), { kind: "unknown" })
  assert.equal(proformaConversionOutcomeOf(proforma).kind, "available")
})

void test("a series no longer in the catalogue counts as nothing chosen", () => {
  assert.equal(effectiveInvoiceSeries(["FCT", "FCT2"], "FCT2"), "FCT2")
  assert.equal(effectiveInvoiceSeries(["FCT"], "GONE"), "")
  assert.equal(effectiveInvoiceSeries([], ""), "")
})

void test("the recovery summary names the proforma and the series the invoice will take", () => {
  assert.deepEqual(proformaConversionSummary(proforma, "FCT"), {
    buyerName: "Alfa SRL", series: "FCT", issueDate: "2026-02-01", lineCount: 1,
  })
})
