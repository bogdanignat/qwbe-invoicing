import assert from "node:assert/strict"
import test from "node:test"

import { decodeCustomer, decodeDocumentSeries, decodeDocumentSeriesList, decodeDraft, decodeDrafts, decodeIssuer, decodePaymentSummary, invoiceDocumentSeries } from "./models.ts"

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
