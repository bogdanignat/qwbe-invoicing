import assert from "node:assert/strict"
import test from "node:test"

import { decodeCustomer, decodeDocumentSeries, decodeDocumentSeriesList, decodeDraft, decodeDrafts, decodeInvoice, decodeIssuer, decodePaymentSummary, decodeProductPreset, decodeProductPresets, decodeProforma, decodeProformas, invoiceDocumentSeries, proformaDocumentSeries } from "./models.ts"

void test("decodes optional address and payment fields without leaking null", () => {
  assert.deepEqual(decodeCustomer({
    id: "customer-1", organizationId: "org-1", partyType: "company", legalName: "Client", taxIdentifier: "RO1",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada 1", county: null, postalCode: undefined },
  }), {
    id: "customer-1", organizationId: "org-1", partyType: "company", legalName: "Client", taxIdentifier: "RO1",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada 1" },
  })
  assert.deepEqual(decodePaymentSummary({ invoiceId: "invoice-1", status: "paid", paidAmount: "121.00", remainingAmount: "0.00", payments: [{ id: "payment-1", amount: "121.00", currency: "RON", paymentDate: "2026-08-31", method: "transfer", externalReference: null }] }).payments[0], {
    id: "payment-1", amount: "121.00", currency: "RON", paymentDate: "2026-08-31", method: "transfer",
  })
})

void test("rejects malformed external API values and unknown payment statuses", () => {
  assert.throws(() => decodeCustomer(null), /expected object/)
  assert.throws(() => decodeCustomer({ id: 1 }), /invalid/)
  assert.throws(() => decodePaymentSummary({ invoiceId: "invoice-1", status: "settled", paidAmount: "0.00", remainingAmount: "1.00", payments: [] }), /invalid payment status/)
})

void test("decodes customer payment terms and product presets", () => {
  const baseCustomer = {
    id: "customer-1", organizationId: "org-1", partyType: "company", legalName: "Client", taxIdentifier: "RO1",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada 1" },
  }
  assert.equal(decodeCustomer({ ...baseCustomer, defaultPaymentTermDays: 0 }).defaultPaymentTermDays, 0)
  assert.equal(decodeCustomer({ ...baseCustomer, defaultPaymentTermDays: null }).defaultPaymentTermDays, undefined)
  assert.throws(() => decodeCustomer({ ...baseCustomer, defaultPaymentTermDays: -1 }), /invalid defaultPaymentTermDays/)
  assert.throws(() => decodeCustomer({ ...baseCustomer, defaultPaymentTermDays: "15" }), /invalid defaultPaymentTermDays/)
  const preset = { id: "preset-1", organizationId: "org-1", description: "Consultanță", unitPrice: "100.00" }
  assert.deepEqual(decodeProductPreset(preset), preset)
  assert.deepEqual(decodeProductPresets([preset]), [preset])
  assert.throws(() => decodeProductPreset({ ...preset, unitPrice: 100 }), /invalid unitPrice/)
})

void test("requires integer issuer terms and decodes tax configuration", () => {
  const input = {
    organizationId: "org-1", legalName: "QWBE", taxIdentifier: "RO2",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada 2" },
    defaultCurrency: "RON", defaultPaymentTermDays: 15,
    taxConfigurations: [{ code: "RO_STANDARD", category: "standard", rate: "21.00", effectiveFrom: "2026-01-01", effectiveTo: null }],
  }
  assert.equal(decodeIssuer(input).taxConfigurations[0]?.effectiveTo, undefined)
  assert.throws(() => decodeIssuer({ ...input, defaultPaymentTermDays: "15" }), /invalid defaultPaymentTermDays/)
})

void test("decodes document series and requires supported document types", () => {
  assert.deepEqual(decodeDocumentSeriesList([
    { organizationId: "org-1", documentType: "invoice", series: "QWBE" },
    { organizationId: "org-1", documentType: "proforma", series: "PRO" },
  ]), [
    { organizationId: "org-1", documentType: "invoice", series: "QWBE" },
    { organizationId: "org-1", documentType: "proforma", series: "PRO" },
  ])
  assert.throws(() => decodeDocumentSeries({ organizationId: "org-1", documentType: "receipt", series: "CH" }), /invalid documentType/)
  assert.deepEqual(invoiceDocumentSeries(decodeDocumentSeriesList([
    { organizationId: "org-1", documentType: "proforma", series: "PRO" },
    { organizationId: "org-1", documentType: "invoice", series: "ONLINE" },
  ])).map((item) => item.series), ["ONLINE"])
  assert.deepEqual(invoiceDocumentSeries([]), [])
  assert.deepEqual(proformaDocumentSeries(decodeDocumentSeriesList([
    { organizationId: "org-1", documentType: "invoice", series: "ONLINE" },
    { organizationId: "org-1", documentType: "proforma", series: "PRO" },
  ])).map((item) => item.series), ["PRO"])
})

const commercialDocument = {
  id: "proforma-1", sourceDraftId: "draft-1", organizationId: "org-1", series: "PRO", number: 7,
  issueDate: "2026-09-01", dueDate: null, issuedAt: "2026-09-01T10:00:00.000Z", currency: "RON",
  issuer: { legalName: "QWBE", taxIdentifier: "RO2", address: { countryCode: "RO", city: "Botoșani", street: "Strada 2" } },
  customer: { partyType: "company", legalName: "Client", taxIdentifier: "RO1", address: { countryCode: "RO", city: "Iași", street: "Strada 1" } },
  lines: [{ id: "line-1", description: "Serviciu", quantity: "1.0000", unitPrice: "100.00", taxCode: "RO_STANDARD", taxCategory: "standard", taxRate: "21.00", totalExcludingTax: "100.00", taxAmount: "21.00", totalIncludingTax: "121.00" }],
  taxBreakdown: [{ taxCode: "RO_STANDARD", category: "standard", rate: "21.00", taxableAmount: "100.00", taxAmount: "21.00" }],
  totalExcludingTax: "100.00", taxTotal: "21.00", totalIncludingTax: "121.00",
  invoiceSeries: "QWBE", convertedDraftId: null, convertedInvoiceId: null,
}

void test("strictly decodes nullable commercial dates and proforma conversion state", () => {
  assert.equal(decodeProforma(commercialDocument).dueDate, null)
  assert.equal(decodeProformas([{ ...commercialDocument, convertedDraftId: "draft-2" }])[0]?.convertedDraftId, "draft-2")
  assert.equal(decodeProformas([{ ...commercialDocument, sourceDraftId: null, convertedInvoiceId: "invoice-2" }])[0]?.convertedInvoiceId, "invoice-2")
  assert.throws(() => decodeProforma({ ...commercialDocument, dueDate: undefined }), /invalid dueDate/)
  assert.throws(() => decodeProforma({ ...commercialDocument, dueDate: 15 }), /invalid dueDate/)
  assert.throws(() => decodeProforma({ ...commercialDocument, convertedDraftId: undefined }), /invalid convertedDraftId/)
  assert.throws(() => decodeProforma({ ...commercialDocument, convertedDraftId: 2 }), /invalid convertedDraftId/)
  assert.equal(decodeDraft({ ...commercialDocument, status: "draft", customerId: "customer-1" }).dueDate, null)
  assert.throws(() => decodeDraft({ ...commercialDocument, status: "draft", customerId: "customer-1", dueDate: undefined }), /invalid dueDate/)
  assert.equal(decodeInvoice({ ...commercialDocument, draftId: null, sourceProformaId: "proforma-1", eFacturaStatus: "not_sent" }).sourceProformaId, "proforma-1")
  assert.throws(() => decodeInvoice({ ...commercialDocument, draftId: "draft-1", sourceProformaId: null, eFacturaStatus: "not_sent", dueDate: false }), /invalid dueDate/)
})

void test("requires the series fixed on a draft", () => {
  const draft = {
    id: "draft-1", organizationId: "org-1", customerId: "customer-1",
    customer: { partyType: "company", legalName: "Client", taxIdentifier: "RO1", address: { countryCode: "RO", city: "Iași", street: "Strada 1" } },
    series: "QWBE", issueDate: "2026-09-01", dueDate: "2026-09-16", currency: "RON", status: "draft", lines: [],
    taxBreakdown: [], totalExcludingTax: "0.00", taxTotal: "0.00", totalIncludingTax: "0.00",
  }
  assert.equal(decodeDraft(draft).series, "QWBE")
  assert.equal(decodeDrafts([draft])[0]?.customer.partyType, "company")
  assert.throws(() => decodeDraft({ ...draft, series: undefined }), /invalid series/)
})

void test("decodes inline individual buyers and complete server totals", () => {
  const decoded = decodeDraft({
    id: "draft-2", organizationId: "org-1",
    customer: { partyType: "individual", legalName: "Ana Pop", taxIdentifier: "", address: { countryCode: "RO", city: "Iași", street: "Strada 2" } },
    series: "QWBE", issueDate: "2026-09-01", dueDate: "2026-09-16", currency: "RON", status: "draft",
    lines: [{ id: "line-1", description: "Serviciu", quantity: "1.0000", unitPrice: "100.00", taxCode: "RO_STANDARD", taxCategory: "standard", taxRate: "21.00", totalExcludingTax: "100.00", taxAmount: "21.00", totalIncludingTax: "121.00" }],
    taxBreakdown: [{ taxCode: "RO_STANDARD", category: "standard", rate: "21.00", taxableAmount: "100.00", taxAmount: "21.00" }],
    totalExcludingTax: "100.00", taxTotal: "21.00", totalIncludingTax: "121.00",
  })
  assert.equal(decoded.customerId, undefined)
  assert.equal(decoded.customer.taxIdentifier, "")
  assert.equal(decoded.taxBreakdown[0]?.taxableAmount, "100.00")
})
