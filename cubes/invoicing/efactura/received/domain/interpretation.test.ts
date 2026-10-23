import assert from "node:assert/strict"
import test from "node:test"

import { interpretArchive } from "./interpretation.ts"
import { BUYER_CIF, TAX_TOTALS, sampleXml, totals } from "../../received-samples.test-support.ts"

const opened = (xml: string) => ({ ok: true, invoice: new TextEncoder().encode(xml) }) as const

void test("a read invoice gives its list columns, the whole document and its warnings", () => {
  const read = interpretArchive(opened(sampleXml()), BUYER_CIF)
  assert.equal(read.readable, true)
  assert.deepEqual(read.listing, {
    kind: "invoice", number: "FX 100", issueDate: "2026-10-01", currency: "RON", supplierName: "FURNIZOR SRL",
    supplierCif: "RO 11111111", totalExcludingTax: "180.00", taxTotal: "37.80", payable: "217.80",
  })
  assert.equal(read.document.dueDate, "2026-10-31")
  assert.deepEqual(read.warnings, [])
})

void test("totals written with fewer decimals are read exactly at 2; a credit note keeps the sign the XML wrote", () => {
  const read = interpretArchive(opened(sampleXml({ root: "CreditNote", header: "<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>",
    totals: totals("RON", "217.8"), lines: "" })), BUYER_CIF)
  assert.equal(read.readable && read.listing.kind, "credit_note")
  assert.equal(read.readable && read.listing.payable, "217.80")
  assert.deepEqual(read.readable && read.document.dueDate, undefined, "no due date stays absent, never a column")
})

void test("a buyer that is not the organization is a warning, not a refusal", () => {
  const read = interpretArchive(opened(sampleXml()), "99999999")
  assert.equal(read.readable, true)
  assert.deepEqual(read.warnings.map(({ code }) => code), ["buyer_cif_mismatch"])
})

void test("a ZIP refused, bytes that are not UTF-8 or XML that is not UBL are unreadable, with the reason", () => {
  assert.deepEqual(interpretArchive({ ok: false, refusal: "crc" }, BUYER_CIF), { readable: false, reason: { source: "zip", refusal: "crc" } })
  assert.deepEqual(interpretArchive({ ok: true, invoice: Uint8Array.of(0x3c, 0xff, 0x3e) }, BUYER_CIF),
    { readable: false, reason: { source: "encoding" } })
  assert.deepEqual(interpretArchive(opened("<Order/>"), BUYER_CIF), { readable: false, reason: { source: "ubl", failure: { reason: "not_ubl" } } })
})

void test("a total past 2 decimals, in another currency or missing is not rounded or guessed: unreadable, with its path", () => {
  const failure = (xml: string) => {
    const read = interpretArchive(opened(xml), BUYER_CIF)
    return read.readable ? undefined : read.reason
  }
  assert.deepEqual(failure(sampleXml({ totals: totals("RON").replace(">180.00<", ">180.001<") })),
    { source: "ubl", failure: { reason: "invalid", field: "cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount" } })
  assert.deepEqual(failure(sampleXml({ totals: totals("RON").replace(">217.80</cbc:Payable", ">99999999999999999999.00</cbc:Payable") })),
    { source: "ubl", failure: { reason: "invalid", field: "cac:LegalMonetaryTotal/cbc:PayableAmount" } })
  assert.deepEqual(failure(sampleXml({ taxTotals: "" })), { source: "ubl", failure: { reason: "missing", field: "cac:TaxTotal/cbc:TaxAmount" } })
  assert.deepEqual(failure(sampleXml({ taxTotals: TAX_TOTALS.replaceAll("RON", "EUR") })),
    { source: "ubl", failure: { reason: "invalid", field: "cac:TaxTotal/cbc:TaxAmount@currencyID" } })
})
