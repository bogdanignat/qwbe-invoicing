import assert from "node:assert/strict"
import test from "node:test"

import { createDraftPayload, draftLinesForEditing, formFromDraft, headerMatchesDraft, initialBuyerSelection, linesMatchDraft, pendingLineOperations, switchBuyerMode, switchPartyType, type InvoiceAuthoringForm } from "./invoice-authoring-state.ts"
import type { DraftInvoice } from "./models.ts"

const manualForm: InvoiceAuthoringForm = {
  buyerMode: "one-time", customerId: "", partyType: "individual", legalName: "Ana Pop", companyTaxIdentifier: "RO123", individualTaxIdentifier: "",
  countryCode: "RO", city: "Iași", street: "Strada 1", county: "", postalCode: "", series: "QWBE",
  issueDate: "2026-09-02", dueDate: "2026-09-17",
}

const draft: DraftInvoice = {
  id: "draft-1", organizationId: "org-1", customer: { partyType: "individual", legalName: "Ana Pop", taxIdentifier: "", address: { countryCode: "RO", city: "Iași", street: "Strada 1" } },
  series: "QWBE", issueDate: "2026-09-02", dueDate: "2026-09-17", currency: "RON", status: "draft", lines: [], taxBreakdown: [],
  totalExcludingTax: "0.00", taxTotal: "0.00", totalIncludingTax: "0.00",
}

void test("builds the exact one-time buyer payload and preserves blank optional CNP", () => {
  assert.deepEqual(createDraftPayload(manualForm), {
    customer: { partyType: "individual", legalName: "Ana Pop", taxIdentifier: "", address: { countryCode: "RO", city: "Iași", street: "Strada 1" } },
    series: "QWBE", issueDate: "2026-09-02", dueDate: "2026-09-17", currency: "RON",
  })
})

void test("switching buyer modes retains one-time buyer data", () => {
  const saved = switchBuyerMode(manualForm, "saved")
  assert.equal(saved.legalName, "Ana Pop")
  assert.equal(switchBuyerMode(saved, "one-time").individualTaxIdentifier, "")
})

void test("requires explicit saved-customer selection and falls back to one-time mode for an empty registry", () => {
  assert.deepEqual(initialBuyerSelection(true), { buyerMode: "saved", customerId: "" })
  assert.deepEqual(initialBuyerSelection(false), { buyerMode: "one-time", customerId: "" })
})

void test("switching PJ/PF preserves distinct typed identifiers", () => {
  const company = { ...manualForm, partyType: "company" as const, companyTaxIdentifier: "RO123", individualTaxIdentifier: "1960523420018" }
  const individual = switchPartyType(company, "individual")
  assert.equal(createDraftPayload(company).customer?.taxIdentifier, "RO123")
  assert.equal(createDraftPayload(individual).customer?.taxIdentifier, "1960523420018")
  assert.equal(switchPartyType(individual, "company").companyTaxIdentifier, "RO123")
})

void test("rehydrates inline buyer drafts and detects unsaved header changes", () => {
  const form = formFromDraft(draft)
  assert.equal(form.buyerMode, "one-time")
  assert.equal(headerMatchesDraft(form, draft), true)
  assert.equal(headerMatchesDraft({ ...form, companyTaxIdentifier: "RO999" }, draft), true)
  assert.equal(headerMatchesDraft({ ...form, city: "Cluj-Napoca" }, draft), false)
})

void test("detects edited and queued lines before issue", () => {
  const withLine: DraftInvoice = { ...draft, lines: [{ id: "line-1", description: "Serviciu", quantity: "1.0000", unitPrice: "100.00", taxCode: "RO_STANDARD", taxCategory: "standard", taxRate: "21.00", totalExcludingTax: "100.00", taxAmount: "21.00", totalIncludingTax: "121.00" }] }
  const lines = draftLinesForEditing(withLine)
  assert.equal(linesMatchDraft(lines, withLine), true)
  assert.equal(linesMatchDraft([{ ...lines[0] as NonNullable<typeof lines[0]>, quantity: "2" }], withLine), false)
})

void test("selects only remaining new or changed lines for a resumed save", () => {
  const withLine: DraftInvoice = { ...draft, lines: [{ id: "line-1", description: "Serviciu", quantity: "1.0000", unitPrice: "100.00", taxCode: "RO_STANDARD", taxCategory: "standard", taxRate: "21.00", totalExcludingTax: "100.00", taxAmount: "21.00", totalIncludingTax: "121.00" }] }
  const persisted = draftLinesForEditing(withLine)[0]
  assert.ok(persisted)
  const queued = { key: "local-2", description: "Transport", quantity: "1", unitPrice: "20", taxCode: "RO_STANDARD" }
  assert.deepEqual(pendingLineOperations([persisted, queued], withLine).map((operation) => operation.kind), ["create"])
  assert.deepEqual(pendingLineOperations([{ ...persisted, unitPrice: "110" }, queued], withLine).map((operation) => operation.kind), ["update", "create"])
})
