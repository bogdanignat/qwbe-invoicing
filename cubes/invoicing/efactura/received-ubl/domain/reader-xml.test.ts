import assert from "node:assert/strict"
import test from "node:test"

import type { ReadFailure, ReceivedDocument } from "./document.ts"
import { readReceivedUbl } from "./reader.ts"
import { BUYER_CIF, UBL, sampleXml } from "../../received-samples.test-support.ts"

const document = (xml: string): ReceivedDocument => {
  const result = readReceivedUbl(xml, BUYER_CIF)
  assert.ok(result.ok, JSON.stringify(result))
  return result.document
}

const failure = (xml: string): ReadFailure => {
  const result = readReceivedUbl(xml, BUYER_CIF)
  assert.ok(!result.ok, "expected a refusal")
  return result.failure
}

void test("reads by namespace URI whatever the prefixes, including a default cbc and a prefix declared on the element", () => {
  const renamed = sampleXml()
    .replaceAll("cbc:", "ns1:").replaceAll("cac:", "a:").replace("xmlns:cbc=", "xmlns:ns1=").replace("xmlns:cac=", "xmlns:a=")
    .replace(`<Invoice xmlns="${UBL.invoice}"`, `<inv:Invoice xmlns:inv="${UBL.invoice}"`).replace("</Invoice>", "</inv:Invoice>")
    .replace("<ns1:ID>FX 100</ns1:ID>", `<x:ID xmlns:x="${UBL.cbc}">FX 100</x:ID>`)
    .replace(/<a:OrderReference>.*<\/a:OrderReference>/u, `<a:OrderReference><ID xmlns="${UBL.cbc}">CMD-7</ID></a:OrderReference>`)
  assert.ok(renamed.includes("<ns1:IssueDate>") && renamed.includes("<inv:Invoice "))
  assert.deepEqual(document(renamed), document(sampleXml()))
})

void test("an element with the right local name in another namespace is not read", () => {
  const xml = sampleXml({ header: `<other:ID xmlns:other="urn:example:other">FALS</other:ID><Note>in the root's namespace</Note>` })
  const read = document(xml.replace("<cbc:ID>FX 100</cbc:ID>", `<cbc:ID>FX 100</cbc:ID><ID xmlns="${UBL.cac}">FALS</ID>`))
  assert.equal(read.number, "FX 100")
  assert.deepEqual(read.notes, [])
  assert.deepEqual(failure(sampleXml().replace(`xmlns="${UBL.invoice}"`, `xmlns="urn:example:Invoice-2"`)), { reason: "not_ubl" })
  assert.deepEqual(failure(sampleXml().replace(`xmlns:cbc="${UBL.cbc}"`, "")), { reason: "unbound_prefix", field: "cbc:CustomizationID" })
})

void test("comments and CDATA from another program are read, a byte-order mark is dropped", () => {
  const xml = `\uFEFF${sampleXml({ header: `<!-- scris de alt program --><cbc:Note><![CDATA[Nota <cu> & semne]]></cbc:Note>` })}`
    .replace("<cbc:ID>FX 100</cbc:ID>", "<cbc:ID><!-- serie -->FX <![CDATA[100]]></cbc:ID>")
  const read = document(xml)
  assert.equal(read.number, "FX 100")
  assert.deepEqual(read.notes, ["Nota <cu> & semne"])
})

void test("a DOCTYPE, an entity or an encoding other than UTF-8 is refused before anything is read", () => {
  const doctype = sampleXml().replace(`<?xml version="1.0" encoding="UTF-8"?>`, `<!DOCTYPE Invoice [<!ENTITY x SYSTEM "file:///etc/passwd">]>`)
  assert.deepEqual(failure(doctype), { reason: "xml", refusal: "doctype" })
  assert.deepEqual(failure(sampleXml({ header: "<cbc:Note>&x;</cbc:Note>" })), { reason: "xml", refusal: "entity" })
  assert.deepEqual(failure(sampleXml().replace("UTF-8", "ISO-8859-2")), { reason: "xml", refusal: "malformed" })
})

void test("a required field written twice is refused, never chosen between", () => {
  const twice = (element: string): string => sampleXml().replace(element, `${element}${element}`)
  assert.deepEqual(failure(twice("<cbc:ID>FX 100</cbc:ID>")), { reason: "duplicate", field: "cbc:ID" })
  assert.deepEqual(failure(twice("<cbc:IssueDate>2026-10-01</cbc:IssueDate>")), { reason: "duplicate", field: "cbc:IssueDate" })
  assert.deepEqual(failure(twice("<cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>")), { reason: "duplicate", field: "cbc:DocumentCurrencyCode" })
  const supplier = /<cac:AccountingSupplierParty>[\s\S]*<\/cac:AccountingSupplierParty>/u.exec(sampleXml())?.[0] ?? ""
  assert.deepEqual(failure(twice(supplier)), { reason: "duplicate", field: "cac:AccountingSupplierParty/cac:Party" })
  assert.deepEqual(failure(twice(`<cbc:PayableAmount currencyID="RON">217.80</cbc:PayableAmount>`)), { reason: "duplicate", field: "cbc:PayableAmount" })
  const legal = /<cac:LegalMonetaryTotal>[\s\S]*<\/cac:LegalMonetaryTotal>/u.exec(sampleXml())?.[0] ?? ""
  assert.deepEqual(failure(twice(legal)), { reason: "duplicate", field: "cac:LegalMonetaryTotal" })
})

void test("a missing required field or an invalid value is refused with its path", () => {
  assert.deepEqual(failure(sampleXml().replace("<cbc:IssueDate>2026-10-01</cbc:IssueDate>", "")), { reason: "missing", field: "cbc:IssueDate" })
  assert.deepEqual(failure(sampleXml().replace("<cbc:ID>FX 100</cbc:ID>", "<cbc:ID>  </cbc:ID>")), { reason: "missing", field: "cbc:ID" })
  assert.deepEqual(failure(sampleXml().replace(">217.80</cbc:PayableAmount>", ">217,80</cbc:PayableAmount>")),
    { reason: "invalid", field: "cbc:PayableAmount" })
  assert.deepEqual(failure(sampleXml().replace("2026-10-01", "2026-02-30")), { reason: "invalid", field: "cbc:IssueDate" })
  assert.deepEqual(failure(sampleXml().replace(`<cbc:PayableAmount currencyID="RON">`, "<cbc:PayableAmount>")),
    { reason: "missing", field: "cbc:PayableAmount@currencyID" })
  assert.deepEqual(failure(sampleXml().replace(">RON</cbc:DocumentCurrencyCode>", ">lei</cbc:DocumentCurrencyCode>")),
    { reason: "invalid", field: "cbc:DocumentCurrencyCode" })
  assert.deepEqual(failure(sampleXml().replace(`<cbc:TaxAmount currencyID="RON">37.80</cbc:TaxAmount>`, `<cbc:TaxAmount currencyID="USD">37.80</cbc:TaxAmount>`)),
    { reason: "invalid", field: "cac:TaxTotal/cbc:TaxAmount@currencyID" })
  assert.deepEqual(failure(sampleXml().replace("<cbc:ChargeIndicator>false", "<cbc:ChargeIndicator>nu")), { reason: "invalid", field: "cbc:ChargeIndicator" })
})

void test("amounts keep the xs:decimal they were written as", () => {
  const read = document(sampleXml().replace(">110.00</cbc:PriceAmount>", ">+110.0000</cbc:PriceAmount>"))
  assert.equal(read.lines[1]?.unitPrice?.value, "+110.0000")
})
