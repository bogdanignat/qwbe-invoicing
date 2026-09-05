import assert from "node:assert/strict"
import test from "node:test"

import { addCalendarDays, applyProductPreset, authoringAccess, authoringDocumentPayload, authoringPayloadMatchesDraft, authoringReadiness, authoringSeriesOptions, createDraftPayload, draftLinePayload, draftLinesForEditing, editDueDate, formFromDraft, headerMatchesDraft, initialBuyerSelection, linesMatchDraft, newAuthoringForm, pendingLineOperations, selectBuyerMode, selectIssueDate, selectedSavedCustomer, selectSavedCustomer, switchBuyerMode, switchPartyType, updateDraftPayload, type InvoiceAuthoringForm } from "./invoice-authoring-state.ts"
import type { Customer, DraftInvoice, Issuer, ProductPreset } from "./models.ts"
const each = { code: "C62", name: "unitate" } as const

const manualForm: InvoiceAuthoringForm = {
  buyerMode: "one-time", customerId: "", partyType: "individual", legalName: "Ana Pop", companyTaxIdentifier: "RO123", individualTaxIdentifier: "",
  countryCode: "RO", city: "Iași", street: "Strada 1", county: "", postalCode: "", series: "QWBE",
  issueDate: "2026-09-02", dueDate: "2026-09-17", dueDateEdited: true,
}

const draft: DraftInvoice = {
  id: "draft-1", organizationId: "org-1", customer: { partyType: "individual", legalName: "Ana Pop", taxIdentifier: "", address: { countryCode: "RO", city: "Iași", street: "Strada 1" } },
  series: "QWBE", issueDate: "2026-09-02", dueDate: "2026-09-17", currency: "RON", status: "draft", lines: [], taxBreakdown: [],
  totalExcludingTax: "0.00", taxTotal: "0.00", totalIncludingTax: "0.00",
}

const issuer: Issuer = {
  organizationId: "org-1", legalName: "QWBE", taxIdentifier: "RO2",
  address: { countryCode: "RO", city: "Botoșani", street: "Strada 2" },
  defaultCurrency: "RON", defaultPaymentTermDays: 15, taxConfigurations: [],
}

const customer: Customer = {
  id: "customer-1", organizationId: "org-1", partyType: "company", legalName: "Client", taxIdentifier: "RO1",
  address: { countryCode: "RO", city: "Iași", street: "Strada 1" }, defaultPaymentTermDays: 30,
}

void test("builds the exact one-time buyer payload and preserves blank optional CNP", () => {
  assert.deepEqual(createDraftPayload(manualForm), {
    customer: { partyType: "individual", legalName: "Ana Pop", taxIdentifier: "", address: { countryCode: "RO", city: "Iași", street: "Strada 1" } },
    series: "QWBE", issueDate: "2026-09-02", dueDate: "2026-09-17", currency: "RON",
  })
})

void test("switching buyer modes retains one-time buyer data", () => {
  const saved = { ...switchBuyerMode(manualForm, "saved"), customerId: customer.id }
  assert.equal(saved.legalName, "Ana Pop")
  assert.equal(selectedSavedCustomer(saved, [customer]), customer)
  const oneTime = { ...switchBuyerMode(saved, "one-time"), dueDateEdited: false }
  assert.equal(oneTime.individualTaxIdentifier, "")
  assert.equal(selectedSavedCustomer(oneTime, [customer]), undefined)
  assert.equal(selectIssueDate(oneTime, "2026-09-05", selectedSavedCustomer(oneTime, [customer]), issuer, true).dueDate, "2026-09-20")
})

void test("requires explicit saved-customer selection and falls back to one-time mode for an empty registry", () => {
  assert.deepEqual(initialBuyerSelection(true), { buyerMode: "saved", customerId: "" })
  assert.deepEqual(initialBuyerSelection(false), { buyerMode: "one-time", customerId: "" })
})

void test("derives new-document due dates from the selected customer and falls back to issuer terms", () => {
  const form = newAuthoringForm(issuer, "QWBE", true, "2026-09-04")
  const customerWithoutTerm: Customer = { id: "customer-3", organizationId: "org-1", partyType: "company", legalName: "Client", taxIdentifier: "RO1", address: customer.address }
  assert.equal(form.dueDate, "2026-09-19")
  assert.equal(selectSavedCustomer(form, customer.id, customer, issuer, true).dueDate, "2026-10-04")
  assert.equal(selectSavedCustomer(form, "customer-2", { ...customer, id: "customer-2", defaultPaymentTermDays: 0 }, issuer, true).dueDate, "2026-09-04")
  assert.equal(selectSavedCustomer(form, "customer-3", customerWithoutTerm, issuer, true).dueDate, "2026-09-19")
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01")
  assert.equal(addCalendarDays("", 30), "")
  assert.equal(addCalendarDays("2026-02-30", 30), "")
  assert.equal(addCalendarDays("9999-12-31", Number.MAX_SAFE_INTEGER), "")
  assert.equal(selectIssueDate(form, "2026-09-05", customer, issuer, true).dueDate, "2026-10-05")
  assert.equal(selectIssueDate(form, "", customer, issuer, true).dueDate, "")
  assert.equal(selectIssueDate({ ...form, dueDate: "2027-01-01", dueDateEdited: true }, "2026-09-05", customer, issuer, true).dueDate, "2027-01-01")
  assert.equal(selectIssueDate({ ...form, dueDate: "", dueDateEdited: true }, "2026-09-05", customer, issuer, true).dueDate, "")
})

void test("recalculates automatic terms across buyer modes and preserves manual due dates", () => {
  const selected = selectSavedCustomer(newAuthoringForm(issuer, "QWBE", true, "2026-09-04"), customer.id, customer, issuer, true)
  const oneTime = selectBuyerMode(selected, "one-time", [customer], issuer, true)
  assert.equal(oneTime.dueDate, "2026-09-19")
  assert.equal(selectBuyerMode(oneTime, "saved", [customer], issuer, true).dueDate, "2026-10-04")

  const custom = editDueDate(selected, "2027-01-01")
  assert.equal(selectBuyerMode(custom, "one-time", [customer], issuer, true).dueDate, "2027-01-01")
  const blank = editDueDate(selected, "")
  assert.equal(selectBuyerMode(blank, "one-time", [customer], issuer, true).dueDate, "")
})

void test("does not recalculate a draft due date when its saved customer changes", () => {
  const existing = { ...manualForm, buyerMode: "saved" as const, dueDate: "2026-09-10" }
  assert.equal(selectSavedCustomer(existing, customer.id, customer, issuer, false).dueDate, "2026-09-10")
  assert.equal(selectIssueDate(existing, "2026-09-05", customer, issuer, false).dueDate, "2026-09-10")
})

void test("copies a product preset into an editable line without retaining a live relation", () => {
  const line = { key: "local-1", lineId: "line-1", description: "Vechi", quantity: "3", unitPrice: "2.00", unitOfMeasure: each, taxCode: "RO_STANDARD" }
  const preset: ProductPreset = { id: "preset-1", organizationId: "org-1", description: "Consultanță", unitPrice: "100.00", unitOfMeasure: { code: "HUR", name: "oră" } }
  assert.deepEqual(applyProductPreset(line, preset), {
    key: "local-1", lineId: "line-1", description: "Consultanță", quantity: "1", unitPrice: "100.00", unitOfMeasure: preset.unitOfMeasure, taxCode: "RO_STANDARD",
  })
  assert.deepEqual(draftLinePayload(applyProductPreset(line, preset)), {
    description: "Consultanță", quantity: "1", unitPrice: "100.00", unitOfMeasure: preset.unitOfMeasure, taxCode: "RO_STANDARD",
  })
})

void test("prepares invoice and proforma series independently for authoring", () => {
  assert.deepEqual(authoringSeriesOptions([
    { organizationId: "org-1", documentType: "proforma", series: "PRO" },
    { organizationId: "org-1", documentType: "invoice", series: "QWBE" },
  ]), { invoice: ["QWBE"], proforma: ["PRO"] })
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

void test("encodes a cleared due date as null and rehydrates null as a blank control", () => {
  const blank = { ...manualForm, dueDate: "" }
  assert.equal(createDraftPayload(blank).dueDate, null)
  assert.equal(updateDraftPayload(blank).dueDate, null)
  const withoutDueDate = { ...draft, dueDate: null }
  assert.equal(formFromDraft(withoutDueDate).dueDate, "")
  assert.equal(headerMatchesDraft(blank, withoutDueDate), true)
})

void test("detects edited and queued lines before issue", () => {
  const withLine: DraftInvoice = { ...draft, lines: [{ id: "line-1", description: "Serviciu", quantity: "1.0000", unitPrice: "100.00", unitOfMeasure: each, taxCode: "RO_STANDARD", taxCategory: "standard", taxRate: "21.00", totalExcludingTax: "100.00", taxAmount: "21.00", totalIncludingTax: "121.00" }] }
  const lines = draftLinesForEditing(withLine)
  assert.equal(linesMatchDraft(lines, withLine), true)
  assert.equal(linesMatchDraft([{ ...lines[0] as NonNullable<typeof lines[0]>, quantity: "2" }], withLine), false)
  assert.deepEqual(authoringReadiness(formFromDraft(withLine), lines, withLine, false), { editable: true, synchronized: true, hasLines: true, canIssue: true })
  assert.equal(authoringReadiness(formFromDraft(withLine), lines, withLine, true).canIssue, false)
  assert.equal(authoringReadiness(manualForm, lines, undefined, false).canIssue, true)
  assert.deepEqual(authoringDocumentPayload(manualForm, lines).lines, [{
    description: "Serviciu", quantity: "1.0000", unitPrice: "100.00", unitOfMeasure: each, taxCode: "RO_STANDARD",
  }])
  const payload = authoringDocumentPayload(manualForm, lines)
  assert.equal(authoringPayloadMatchesDraft(payload, withLine), true)
  assert.equal(authoringPayloadMatchesDraft(payload, { ...withLine, issueDate: "2026-09-03" }), false)
  assert.equal(authoringPayloadMatchesDraft(payload, { ...withLine, lines: [{ ...withLine.lines[0] as NonNullable<typeof withLine.lines[0]>, quantity: "2.0000" }] }), false)
})

void test("locks issued and proforma-issued draft routes while keeping new and draft authoring editable", () => {
  assert.deepEqual(authoringAccess("draft"), { editable: true })
  assert.deepEqual(authoringAccess("issued"), {
    editable: false,
    notice: "Acest draft a fost deja emis ca factură și este blocat. Nu mai poate fi modificat, șters sau emis din nou.",
    registryHref: "/invoices",
    registryLabel: "Deschide registrul de facturi",
  })
  const proformaAccess = authoringAccess("proforma_issued")
  assert.equal(proformaAccess.editable ? undefined : proformaAccess.registryHref, "/proformas")
  assert.equal(authoringReadiness(manualForm, [], undefined, false).editable, true)
  for (const status of ["issued", "proforma_issued"] as const) {
    const sealed = { ...draft, status, lines: [{ id: "line-1", description: "Serviciu", quantity: "1.0000", unitPrice: "100.00", unitOfMeasure: each, taxCode: "RO_STANDARD", taxCategory: "standard" as const, taxRate: "21.00", totalExcludingTax: "100.00", taxAmount: "21.00", totalIncludingTax: "121.00" }] }
    const readiness = authoringReadiness(formFromDraft(sealed), draftLinesForEditing(sealed), sealed, false)
    assert.deepEqual(readiness, { editable: false, synchronized: false, hasLines: true, canIssue: false })
  }
})

void test("selects only remaining new or changed lines for a resumed save", () => {
  const withLine: DraftInvoice = { ...draft, lines: [{ id: "line-1", description: "Serviciu", quantity: "1.0000", unitPrice: "100.00", unitOfMeasure: each, taxCode: "RO_STANDARD", taxCategory: "standard", taxRate: "21.00", totalExcludingTax: "100.00", taxAmount: "21.00", totalIncludingTax: "121.00" }] }
  const persisted = draftLinesForEditing(withLine)[0]
  assert.ok(persisted)
  const queued = { key: "local-2", description: "Transport", quantity: "1", unitPrice: "20", unitOfMeasure: each, taxCode: "RO_STANDARD" }
  assert.deepEqual(pendingLineOperations([persisted, queued], withLine).map((operation) => operation.kind), ["create"])
  assert.deepEqual(pendingLineOperations([{ ...persisted, unitPrice: "110" }, queued], withLine).map((operation) => operation.kind), ["update", "create"])
})
