import assert from "node:assert/strict"
import test from "node:test"

import type { ReceivedWarning } from "./document.ts"
import { readReceivedUbl } from "./reader.ts"
import { BUYER_CIF, sampleXml, totals, vatScheme } from "./samples.test-support.ts"

const warnings = (xml: string, expectedCif = BUYER_CIF): ReadonlyArray<ReceivedWarning> => {
  const result = readReceivedUbl(xml, expectedCif)
  assert.ok(result.ok, JSON.stringify(result))
  return result.warnings
}

void test("a consistent document has no warning, with the expected CIF written with RO and spaces", () => {
  assert.deepEqual(warnings(sampleXml()), [])
  assert.deepEqual(warnings(sampleXml(), ` RO ${BUYER_CIF} `), [])
})

void test("lines that do not add up to LineExtensionAmount are a warning, summed exactly at the XML's precision", () => {
  const xml = sampleXml().replace(">110.00</cbc:LineExtensionAmount>", ">110.005</cbc:LineExtensionAmount>")
  assert.deepEqual(warnings(xml), [{ code: "lines_total_mismatch", declared: "200.00", computed: "200.005" }])
})

void test("TaxExclusiveAmount plus the VAT in the document's currency that is not TaxInclusiveAmount is a warning", () => {
  assert.deepEqual(warnings(sampleXml({ totals: totals("RON", "217.81") })),
    [{ code: "tax_inclusive_mismatch", declared: "217.81", computed: "217.80" }])
  assert.deepEqual(warnings(sampleXml({ taxTotals: "", totals: totals("RON", "180.00") })), [])
})

void test("a buyer that is not the organization is a warning; a buyer without VAT matches on its legal identifier", () => {
  assert.deepEqual(warnings(sampleXml(), "87654321"),
    [{ code: "buyer_cif_mismatch", expected: "87654321", found: [`RO${BUYER_CIF}`, "J12/3/2021"] }])
  const withoutVat = `<cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>PFA</cbc:RegistrationName>
    <cbc:CompanyID>${BUYER_CIF}</cbc:CompanyID></cac:PartyLegalEntity></cac:Party>`
  assert.deepEqual(warnings(sampleXml({ buyer: withoutVat })), [])
  const otherScheme = `<cac:Party>${vatScheme(`${BUYER_CIF.slice(0, 4)} ${BUYER_CIF.slice(4)}`, "NOT_VAT")}</cac:Party>`
  assert.deepEqual(warnings(sampleXml({ buyer: otherScheme })), [])
})
