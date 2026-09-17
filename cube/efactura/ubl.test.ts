import assert from "node:assert/strict"
import test from "node:test"

import { EFacturaContractViolation } from "./contracts/failures.ts"
import {
  article310AsExempt, article310AsNotSubject, fullCreditNote, standardB2B, standardB2C, syntheticFixtures,
} from "./fixtures.test-support.ts"
import { DEFAULT_CIUS_RO_PROFILE } from "./profile.ts"
import { renderEFacturaXml } from "./ubl.ts"

/** The children of the document root, in the order they were rendered. UBL
 * imposes an `xsd:sequence`, so the order is the assertion. */
const rootChildren = (xml: string): ReadonlyArray<string> =>
  xml.split("\n").flatMap((line) => /^ {2}<([A-Za-z:]+)[ />]/u.exec(line)?.[1] ?? [])

const element = (xml: string, name: string): ReadonlyArray<string> =>
  [...xml.matchAll(new RegExp(`<${name}(?: [^>]*)?>([^<]*)</${name}>`, "gu"))].map((match) => match[1] ?? "")

void test("renders an invoice with its header in UBL sequence order", () => {
  assert.deepEqual(rootChildren(renderEFacturaXml(standardB2B)), [
    "cbc:CustomizationID", "cbc:ProfileID", "cbc:ID", "cbc:IssueDate", "cbc:DueDate",
    "cbc:InvoiceTypeCode", "cbc:DocumentCurrencyCode",
    "cac:AccountingSupplierParty", "cac:AccountingCustomerParty",
    "cac:TaxTotal", "cac:LegalMonetaryTotal", "cac:InvoiceLine", "cac:InvoiceLine",
  ])
  const xml = renderEFacturaXml(standardB2B)
  assert.ok(xml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Invoice "))
  assert.deepEqual(element(xml, "cbc:InvoiceTypeCode"), ["380"])
})

void test("renders a credit note as a credit note, not as a negated invoice", () => {
  const xml = renderEFacturaXml(fullCreditNote)
  assert.ok(xml.includes("<CreditNote xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2\""))
  assert.deepEqual(element(xml, "cbc:CreditNoteTypeCode"), ["381"])
  assert.deepEqual(rootChildren(xml), [
    "cbc:CustomizationID", "cbc:ProfileID", "cbc:ID", "cbc:IssueDate",
    "cbc:CreditNoteTypeCode", "cbc:Note", "cbc:DocumentCurrencyCode", "cac:BillingReference",
    "cac:AccountingSupplierParty", "cac:AccountingCustomerParty",
    "cac:TaxTotal", "cac:LegalMonetaryTotal", "cac:CreditNoteLine", "cac:CreditNoteLine",
  ])
  // The quantity element is named for the document type, and every amount
  // stays positive: the type code carries the reversal, the numbers do not.
  assert.equal(element(xml, "cbc:CreditedQuantity").length, 2)
  assert.equal(element(xml, "cbc:InvoicedQuantity").length, 0)
  assert.ok(!xml.includes(">-"))
  assert.deepEqual(element(xml, "cbc:PayableAmount"), ["1926.00"])
})

void test("references the corrected invoice by number and date (BG-3)", () => {
  const xml = renderEFacturaXml(fullCreditNote)
  assert.match(xml, /<cac:BillingReference>\s*<cac:InvoiceDocumentReference>\s*<cbc:ID>QWBE 1001<\/cbc:ID>/u)
  assert.ok(element(xml, "cbc:IssueDate").includes(standardB2B.issueDate))
})

void test("renders an out-of-scope document with no VAT percentage anywhere", () => {
  const xml = renderEFacturaXml(article310AsNotSubject)
  assert.equal(element(xml, "cbc:Percent").length, 0)
  assert.deepEqual(element(xml, "cbc:TaxExemptionReasonCode"), ["VATEX-EU-O"])
  assert.equal(element(xml, "cbc:TaxExemptionReason").length, 0)
  // BR-RO-060 places the Article 310 reference in BT-22, not in BT-120.
  assert.match(element(xml, "cbc:Note")[0] ?? "", /art\. 310/u)
})

void test("renders an exempt document with a zero percentage and its written reason", () => {
  const xml = renderEFacturaXml(article310AsExempt)
  assert.deepEqual(element(xml, "cbc:Percent"), ["0.00", "0.00"])
  assert.equal(element(xml, "cbc:TaxExemptionReasonCode").length, 0)
  assert.match(element(xml, "cbc:TaxExemptionReason")[0] ?? "", /art\. 310/u)
})

void test("tells a VAT identifier apart from a plain tax registration by its scheme", () => {
  const exempt = renderEFacturaXml(article310AsExempt)
  assert.match(exempt, /<cbc:CompanyID>19999927<\/cbc:CompanyID>\s*<cac:TaxScheme>\s*<cbc:ID>NOT_VAT</u)
  assert.ok(!exempt.includes("<cbc:CompanyID>RO19999927</cbc:CompanyID>"))
  // The trade registry number is BT-30 and lives on the legal entity, never
  // under a tax scheme, where it would read as a tax identifier.
  assert.match(exempt, /<cac:PartyLegalEntity>\s*<cbc:RegistrationName>[^<]+<\/cbc:RegistrationName>\s*<cbc:CompanyID>J22\/9999\/2021</u)
})

void test("identifies a private individual without claiming a VAT registration", () => {
  const xml = renderEFacturaXml(standardB2C)
  const buyerPart = xml.slice(xml.indexOf("<cac:AccountingCustomerParty>"), xml.indexOf("<cac:TaxTotal>"))
  // BR-RO-120 needs BT-47, but nothing here may suggest the consumer is
  // registered for VAT, so the identifier appears on the legal entity alone.
  assert.ok(!buyerPart.includes("PartyTaxScheme"))
  assert.match(buyerPart, /<cbc:RegistrationName>Ionescu Exemplu<\/cbc:RegistrationName>\s*<cbc:CompanyID>0{13}</u)
})

void test("drops both VAT identifiers on a document that is not subject to VAT", () => {
  // BR-O-02: the parties keep their identity through BT-32 and BT-47. The
  // `VAT` scheme still appears under cac:TaxCategory, where it names the tax
  // the category is about rather than a registration either party holds.
  const xml = renderEFacturaXml(article310AsNotSubject)
  const parties = xml.slice(xml.indexOf("<cac:AccountingSupplierParty>"), xml.indexOf("<cac:TaxTotal>"))
  assert.ok(!parties.includes("<cbc:ID>VAT</cbc:ID>"), parties)
  assert.ok(!parties.includes("RO19999935"), parties)
  assert.match(parties, /<cbc:CompanyID>19999935</u)
})

void test("renders the profile it is given rather than a built-in assumption", () => {
  const xml = renderEFacturaXml(standardB2B, {
    ...DEFAULT_CIUS_RO_PROFILE, customizationId: "urn:test:cius", ublVersionId: "2.1",
  })
  assert.deepEqual(rootChildren(xml).slice(0, 3), ["cbc:UBLVersionID", "cbc:CustomizationID", "cbc:ProfileID"])
  assert.deepEqual(element(xml, "cbc:CustomizationID"), ["urn:test:cius"])
})

void test("labels every amount with the document currency", () => {
  const xml = renderEFacturaXml(standardB2B)
  const amounts = [...xml.matchAll(/<(cbc:\w*Amount)([^>]*)>/gu)]
  assert.ok(amounts.length >= 9)
  for (const [, name, attributes] of amounts) {
    assert.equal(attributes, " currencyID=\"RON\"", `${String(name)} carries no currency`)
  }
})

void test("refuses to render a document it would have to invent values for", () => {
  assert.throws(() => renderEFacturaXml({ ...standardB2B, payableAmount: "999.00" }),
    (error: unknown) => error instanceof EFacturaContractViolation && error.issues.length > 0)
})

void test("renders every synthetic fixture, always to the same bytes", () => {
  for (const fixture of syntheticFixtures) {
    const once = renderEFacturaXml(fixture.document)
    assert.equal(once, renderEFacturaXml(fixture.document), fixture.name)
    assert.ok(once.endsWith("\n"), fixture.name)
    assert.ok(!once.includes("undefined"), fixture.name)
  }
})
