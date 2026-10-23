import assert from "node:assert/strict"
import test from "node:test"

import type { ReceivedDocument } from "./document.ts"
import { readReceivedUbl } from "./reader.ts"
import { BUYER_CIF, TAX_TOTALS, sampleXml, totals } from "../../received-samples.test-support.ts"

const read = (xml: string): ReceivedDocument => {
  const result = readReceivedUbl(xml, BUYER_CIF)
  assert.ok(result.ok, JSON.stringify(result))
  assert.deepEqual(result.warnings, [])
  return result.document
}

void test("reads the header, both parties, references, payment account and totals of an invoice", () => {
  const document = read(sampleXml())
  assert.deepEqual(
    [document.kind, document.typeCode, document.number, document.issueDate, document.dueDate, document.currency, document.notes],
    ["invoice", "380", "FX 100", "2026-10-01", "2026-10-31", "RON", ["Prima nota"]],
  )
  assert.equal("taxCurrency" in document, false)
  assert.deepEqual(document.supplier, {
    name: "FURNIZOR SRL", vatId: "RO 11111111", registrationId: "J40/1/2020",
    address: { street: "Str. Lunga nr. 2", city: "Sector 1", county: "RO-B", country: "RO" },
  })
  assert.equal(document.buyer.vatId, `RO${BUYER_CIF}`)
  assert.deepEqual([document.paymentAccounts, document.orderReference, document.contractReferences, document.billingReferences],
    [["RO49AAAA1B31007593840000"], "CMD-7", ["CTR-1"], []])
  assert.deepEqual(document.totals, {
    lineExtension: { value: "200.00", currency: "RON" }, taxExclusive: { value: "180.00", currency: "RON" },
    taxInclusive: { value: "217.80", currency: "RON" }, allowanceTotal: { value: "20.00", currency: "RON" },
    payable: { value: "217.80", currency: "RON" },
  })
})

void test("reads document and line allowances, VAT by rate and the lines with their codes, at the XML's precision", () => {
  const document = read(sampleXml())
  assert.deepEqual(document.allowanceCharges, [{
    charge: false, amount: { value: "20.00", currency: "RON" }, baseAmount: { value: "200.00", currency: "RON" }, percent: "10",
    reason: "Discount comercial", vatCategory: "S", vatPercent: "21",
  }])
  assert.deepEqual(document.vat, {
    total: { value: "37.80", currency: "RON" },
    breakdown: [{ category: "S", percent: "21", taxable: { value: "180.00", currency: "RON" }, tax: { value: "37.80", currency: "RON" } }],
  })
  assert.deepEqual(document.lines[0], {
    id: "1", name: "Hartie", description: "Hartie A4", quantity: { value: "2.5000", unit: "H87" }, priceBaseQuantity: { value: "1", unit: "H87" },
    unitPrice: { value: "40.000", currency: "RON" }, netAmount: { value: "90.00", currency: "RON" }, vatCategory: "S", vatPercent: "21",
    allowanceCharges: [{ charge: false, amount: { value: "10.00", currency: "RON" }, reason: "Discount linie", reasonCode: "95" }],
    sellerItemId: "HA4", standardItemId: { value: "5941234567890", scheme: "0160" }, classifications: [{ value: "30197630-1", scheme: "STI" }],
  })
  assert.deepEqual(document.lines[1], {
    id: "2", name: "Servicii", quantity: { value: "1", unit: "HUR" }, unitPrice: { value: "110.00", currency: "RON" },
    netAmount: { value: "110.00", currency: "RON" }, vatCategory: "S", vatPercent: "21", allowanceCharges: [], classifications: [],
  })
})

void test("a credit note keeps its billing reference, its signs as written, and takes the due date from PaymentMeans", () => {
  const xml = sampleXml({
    root: "CreditNote",
    header: `<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>
      <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>FX 7</cbc:ID><cbc:IssueDate>2026-09-15</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>`,
    lines: `<cac:CreditNoteLine><cbc:ID>1</cbc:ID><cbc:CreditedQuantity unitCode="H87">2</cbc:CreditedQuantity>
      <cbc:LineExtensionAmount currencyID="RON">200.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Retur</cbc:Name></cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="RON">100.00</cbc:PriceAmount></cac:Price></cac:CreditNoteLine>`,
  }).replace("<cac:PayeeFinancialAccount>", "<cbc:PaymentDueDate>2026-11-15</cbc:PaymentDueDate><cac:PayeeFinancialAccount>")
  const document = read(xml)
  assert.deepEqual([document.kind, document.typeCode, document.dueDate], ["credit_note", "381", "2026-11-15"])
  assert.deepEqual(document.billingReferences, [{ number: "FX 7", issueDate: "2026-09-15" }])
  assert.deepEqual(document.lines.map((line) => [line.quantity, line.netAmount.value]), [[{ value: "2", unit: "H87" }, "200.00"]])
  assert.equal(document.totals.payable.value, "217.80")
})

void test("an invoice in EUR keeps the VAT in EUR and in RON apart, chosen by currencyID", () => {
  const document = read(sampleXml({
    currency: "EUR",
    header: "<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode><cbc:TaxCurrencyCode>RON</cbc:TaxCurrencyCode>",
    taxTotals: `<!-- RON -->${TAX_TOTALS}`,
  }).replaceAll(`currencyID="RON"`, `currencyID="EUR"`)
    .replace("<!-- RON -->", `<cac:TaxTotal><cbc:TaxAmount currencyID="RON">188.10</cbc:TaxAmount></cac:TaxTotal>`))
  assert.deepEqual([document.currency, document.taxCurrency], ["EUR", "RON"])
  assert.deepEqual(document.vat.total, { value: "37.80", currency: "EUR" })
  assert.deepEqual(document.vat.taxCurrencyTotal, { value: "188.10", currency: "RON" })
  assert.deepEqual(document.vat.breakdown.map((rate) => rate.tax), [{ value: "37.80", currency: "EUR" }])
})

void test("category O has no percent, an exemption keeps its code and reason; absent fields stay absent", () => {
  const exempt = `<cac:TaxTotal><cbc:TaxAmount currencyID="RON">0.00</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="RON">100.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="RON">0.00</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>O</cbc:ID><cbc:TaxExemptionReasonCode>VATEX-EU-O</cbc:TaxExemptionReasonCode></cac:TaxCategory></cac:TaxSubtotal>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="RON">80.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="RON">0.00</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>E</cbc:ID><cbc:Percent>0</cbc:Percent><cbc:TaxExemptionReason>Scutit conform art. 292</cbc:TaxExemptionReason></cac:TaxCategory></cac:TaxSubtotal>
  </cac:TaxTotal>`
  const document = read(sampleXml({ header: "", taxTotals: exempt, totals: totals("RON", "180.00") }))
  assert.deepEqual(document.vat.breakdown.map(({ category, percent, exemptionCode, exemptionReason }) => [category, percent, exemptionCode, exemptionReason]),
    [["O", undefined, "VATEX-EU-O", undefined], ["E", "0", undefined, "Scutit conform art. 292"]])
  assert.equal("percent" in (document.vat.breakdown[0] ?? {}), false)
  assert.deepEqual(["typeCode", "dueDate", "taxCurrency"].filter((field) => field in document), [])
  assert.deepEqual(document.notes, [])
})

void test("payment means that disagree on the due date leave it absent, never choose one", () => {
  const xml = sampleXml({ header: "" }).replace("<cac:PayeeFinancialAccount>", "<cbc:PaymentDueDate>2026-11-15</cbc:PaymentDueDate><cac:PayeeFinancialAccount>")
    .replace("<cac:PaymentMeans>", "<cac:PaymentMeans><cbc:PaymentMeansCode>42</cbc:PaymentMeansCode><cbc:PaymentDueDate>2026-11-30</cbc:PaymentDueDate></cac:PaymentMeans><cac:PaymentMeans>")
  const document = read(xml)
  assert.equal(document.paymentAccounts.length, 1)
  assert.equal("dueDate" in document, false)
})

void test("two TaxTotal in the same currency are refused, never added or chosen between", () => {
  const result = readReceivedUbl(sampleXml({ taxTotals: `${TAX_TOTALS}${TAX_TOTALS}` }), BUYER_CIF)
  assert.deepEqual(result, { ok: false, failure: { reason: "duplicate", field: "cac:TaxTotal" } })
})
