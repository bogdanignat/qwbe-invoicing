import assert from "node:assert/strict"
import test from "node:test"

import { decodeCustomer, decodeDocumentSeries, decodeDocumentSeriesList, decodeDraft, decodeIssuer, decodePaymentSummary, invoiceDocumentSeries } from "./models.ts"

void test("decodes optional address and payment fields without leaking null", () => {
  assert.deepEqual(decodeCustomer({
    id: "customer-1", organizationId: "org-1", legalName: "Client", taxIdentifier: "RO1",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada 1", county: null, postalCode: undefined },
  }), {
    id: "customer-1", organizationId: "org-1", legalName: "Client", taxIdentifier: "RO1",
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
    id: "draft-1", customerId: "customer-1", series: "QWBE", issueDate: "2026-09-01",
    dueDate: "2026-09-16", currency: "RON", status: "draft", lines: [],
  }
  assert.equal(decodeDraft(draft).series, "QWBE")
  assert.throws(() => decodeDraft({ ...draft, series: undefined }), /invalid series/)
})
