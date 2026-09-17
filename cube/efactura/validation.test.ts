import assert from "node:assert/strict"
import test from "node:test"

import type { EFacturaDocument, EFacturaLine, EFacturaParty } from "./contracts/document.ts"
import { EFacturaContractViolation } from "./contracts/failures.ts"
import { normalizeSpace } from "./decimals.ts"
import { VATEX_NOT_SUBJECT } from "./vat-rules.ts"
import { validateEFacturaDocument } from "./validation.ts"

const ARTICLE_310 = "Regim special de scutire conform art. 310 din Codul fiscal"

const standardLine: EFacturaLine = { id: "1", name: "Consultanță", quantity: "1.0000", unitCode: "HUR", netAmount: "100.00", unitPrice: "100.00", vatCategory: "S", vatRate: "21.00" }

const seller: EFacturaParty = {
  registrationName: "Acme Software SRL",
  address: { countryCode: "RO", cityName: "Cluj-Napoca", streetName: "Strada Memorandumului 28", countrySubentity: "RO-CJ", postalZone: "400114" },
  vatIdentifier: "RO12345678",
  taxRegistrationIdentifier: null,
  legalRegistrationIdentifier: "J12/123/2020",
}
const buyer: EFacturaParty = {
  registrationName: "Client SRL",
  address: { countryCode: "RO", cityName: "SECTOR1", streetName: "Bulevardul Aviatorilor 1", countrySubentity: "RO-B", postalZone: null },
  vatIdentifier: "RO87654321",
  taxRegistrationIdentifier: null,
  legalRegistrationIdentifier: null,
}

/** A standard-rated single-line invoice: 100.00 net, 21% VAT, 121.00 payable. */
const invoice = (overrides: Partial<EFacturaDocument> = {}): EFacturaDocument => ({
  kind: "invoice",
  id: "QWBE 42",
  issueDate: "2026-09-17",
  dueDate: "2026-10-17",
  currencyCode: "RON",
  notes: [],
  precedingInvoice: null,
  seller,
  buyer,
  lines: [standardLine],
  taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "21.00", category: "S", percent: "21.00", exemptionReason: null, exemptionReasonCode: null }],
  lineExtensionAmount: "100.00",
  taxExclusiveAmount: "100.00",
  taxAmount: "21.00",
  taxInclusiveAmount: "121.00",
  payableAmount: "121.00",
  ...overrides,
})

/** An Article 310 exempt invoice: zero-rated, reason carried as BT-120 text. */
const exemptInvoice = (overrides: Partial<EFacturaDocument> = {}): EFacturaDocument => invoice({
  seller: { ...seller, vatIdentifier: null, taxRegistrationIdentifier: "12345678" },
  lines: [{ id: "1", name: "Consultanță", quantity: "1.0000", unitCode: "HUR", netAmount: "100.00", unitPrice: "100.00", vatCategory: "E", vatRate: "0.00" }],
  taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "E", percent: "0.00", exemptionReason: ARTICLE_310, exemptionReasonCode: null }],
  taxAmount: "0.00",
  taxInclusiveAmount: "100.00",
  payableAmount: "100.00",
  ...overrides,
})

const issues = (document: EFacturaDocument): ReadonlyArray<string> => {
  try {
    validateEFacturaDocument(document)
  } catch (error) {
    assert.ok(error instanceof EFacturaContractViolation)
    return error.issues
  }
  return assert.fail("expected the document to be refused")
}

const rejects = (document: EFacturaDocument, pattern: RegExp): void => {
  assert.ok(issues(document).some((issue) => pattern.test(issue)),
    `expected an issue matching ${pattern.source}, got ${JSON.stringify(issues(document))}`)
}

void test("accepts the supported document shapes", () => {
  validateEFacturaDocument(invoice())
  validateEFacturaDocument(exemptInvoice())
  validateEFacturaDocument(invoice({
    kind: "credit_note", dueDate: null, precedingInvoice: { id: "QWBE 41", issueDate: "2026-09-01" },
  }))
})

void test("accepts several standard rates side by side, including historical ones", () => {
  validateEFacturaDocument(invoice({
    lines: [
      { id: "1", name: "Consultanță", quantity: "1.0000", unitCode: "HUR", netAmount: "100.00", unitPrice: "100.00", vatCategory: "S", vatRate: "21.00" },
      { id: "2", name: "Manual tipărit", quantity: "2.0000", unitCode: "H87", netAmount: "50.00", unitPrice: "25.00", vatCategory: "S", vatRate: "11.00" },
    ],
    taxSubtotals: [
      { taxableAmount: "100.00", taxAmount: "21.00", category: "S", percent: "21.00", exemptionReason: null, exemptionReasonCode: null },
      { taxableAmount: "50.00", taxAmount: "5.50", category: "S", percent: "11.00", exemptionReason: null, exemptionReasonCode: null },
    ],
    lineExtensionAmount: "150.00", taxExclusiveAmount: "150.00", taxAmount: "26.50",
    taxInclusiveAmount: "176.50", payableAmount: "176.50",
  }))
})

void test("refuses an exempt breakdown without a reason, and a standard one carrying it", () => {
  rejects(exemptInvoice({ taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "E", percent: "0.00", exemptionReason: null, exemptionReasonCode: null }] }), /BR-E-10/u)
  rejects(exemptInvoice({ taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "E", percent: "0.00", exemptionReason: "   ", exemptionReasonCode: null }] }), /BR-E-10/u)
  rejects(invoice({ taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "21.00", category: "S", percent: "21.00", exemptionReason: ARTICLE_310, exemptionReasonCode: null }] }), /BR-S-10/u)
})

void test("refuses a zero-rated standard category and a non-zero exempt one", () => {
  rejects(invoice({
    lines: [{ id: "1", name: "x", quantity: "1.0000", unitCode: "H87", netAmount: "100.00", unitPrice: "100.00", vatCategory: "S", vatRate: "0.00" }],
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "S", percent: "0.00", exemptionReason: null, exemptionReasonCode: null }],
    taxAmount: "0.00", taxInclusiveAmount: "100.00", payableAmount: "100.00",
  }), /BR-S-05/u)
  rejects(exemptInvoice({ taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "E", percent: "21.00", exemptionReason: ARTICLE_310, exemptionReasonCode: null }] }), /BR-E-05/u)
})

void test("measures the exemption reason the way the Romanian rule does", () => {
  assert.equal(normalizeSpace("  a   b \n c "), "a b c")
  // XPath collapses only space, tab, CR and LF. A no-break space is a character
  // to the validator, so collapsing it here would pass a document ANAF refuses.
  assert.equal(normalizeSpace("a\u00A0\u00A0b"), "a\u00A0\u00A0b")
  // Nor is it trimmed. `String.trim` would drop it, and then a reason of
  // exactly 100 characters plus a no-break space would measure 100 here and
  // 101 at ANAF — the one length that decides the rule.
  assert.equal(normalizeSpace(" \u00A0a\u00A0 "), "\u00A0a\u00A0")
  rejects(exemptInvoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "E", percent: "0.00", exemptionReason: `${"x".repeat(100)}\u00A0`, exemptionReasonCode: null }],
  }), /BR-RO-L100/u)
  rejects(exemptInvoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "E", percent: "0.00", exemptionReason: `${"x".repeat(50)}\u00A0\u00A0${"y".repeat(49)}`, exemptionReasonCode: null }],
  }), /BR-RO-L100/u)
  // And the limit counts characters, not UTF-16 code units: 60 code points
  // outside the BMP are 120 units and still well inside a 100-character limit.
  validateEFacturaDocument(exemptInvoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "E", percent: "0.00", exemptionReason: "𐊀".repeat(60), exemptionReasonCode: null }],
  }))
  validateEFacturaDocument(exemptInvoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "E", percent: "0.00", exemptionReason: `  ${"x".repeat(50)}   ${"y".repeat(49)}  `, exemptionReasonCode: null }],
  }))
  rejects(exemptInvoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "E", percent: "0.00", exemptionReason: "x".repeat(101), exemptionReasonCode: null }],
  }), /BR-RO-L100/u)
})

void test("allows at most one exempt group", () => {
  rejects(exemptInvoice({
    taxSubtotals: [
      { taxableAmount: "60.00", taxAmount: "0.00", category: "E", percent: "0.00", exemptionReason: ARTICLE_310, exemptionReasonCode: null },
      { taxableAmount: "40.00", taxAmount: "0.00", category: "E", percent: "0.00", exemptionReason: ARTICLE_310, exemptionReasonCode: null },
    ],
  }), /BR-E-01/u)
})

void test("refuses a line whose VAT group is missing from the breakdown", () => {
  // The breakdown does carry category S, so BR-S-01 holds and is not cited:
  // what is missing is a group for the second line's rate.
  rejects(invoice({
    lines: [
      { id: "1", name: "a", quantity: "1.0000", unitCode: "H87", netAmount: "50.00", unitPrice: "50.00", vatCategory: "S", vatRate: "21.00" },
      { id: "2", name: "b", quantity: "1.0000", unitCode: "H87", netAmount: "50.00", unitPrice: "50.00", vatCategory: "S", vatRate: "11.00" },
    ],
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "21.00", category: "S", percent: "21.00", exemptionReason: null, exemptionReasonCode: null }],
  }), /covers category S at another rate/u)
  // Here the category itself is absent, which is what BR-S-01 forbids.
  rejects(invoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "E", percent: "0.00", exemptionReason: ARTICLE_310, exemptionReasonCode: null }],
  }), /BR-S-01/u)
})

void test("reads a VAT rate as a number, so the same group written two ways stays one group", () => {
  // "21" and "21.00" are the same rate. Keying a group on the raw text would
  // refuse this document for a difference of notation that no rule makes.
  validateEFacturaDocument(invoice({ lines: [{ ...standardLine, vatRate: "21" }] }))
  validateEFacturaDocument(invoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "21.00", category: "S", percent: "21", exemptionReason: null, exemptionReasonCode: null }],
  }))
})

void test("catches totals that disagree by a single cent", () => {
  rejects(invoice({ lineExtensionAmount: "100.01" }), /BR-CO-10/u)
  rejects(invoice({ taxAmount: "21.01", taxInclusiveAmount: "121.01", payableAmount: "121.01" }), /BR-CO-14/u)
  rejects(invoice({ taxInclusiveAmount: "121.01", payableAmount: "121.01" }), /BR-CO-15/u)
  rejects(invoice({ payableAmount: "120.00" }), /BR-CO-16/u)
  rejects(invoice({ taxSubtotals: [{ taxableAmount: "99.99", taxAmount: "21.00", category: "S", percent: "21.00", exemptionReason: null, exemptionReasonCode: null }] }),
    /taxable amounts do not sum to taxExclusiveAmount/u)
})

void test("refuses amounts that are negative or carry excess precision", () => {
  rejects(invoice({ payableAmount: "-121.00" }), /payableAmount must be a non-negative decimal/u)
  rejects(invoice({ taxAmount: "21.000" }), /taxAmount carries more than 2 decimal places/u)
  rejects(invoice({ lines: [{ ...standardLine, quantity: "0.00000" }] }), /quantity carries more than 4 decimal/u)
  rejects(invoice({ lines: [{ ...standardLine, quantity: "0.0000" }] }), /quantity must be greater than zero/u)
})

void test("holds a credit note to its own shape: a reference, and no due date", () => {
  rejects(invoice({ kind: "credit_note", dueDate: null, precedingInvoice: null }), /BG-3/u)
  rejects(invoice({ kind: "credit_note", dueDate: "2026-10-17", precedingInvoice: { id: "QWBE 41", issueDate: "2026-09-01" } }), /BT-9/u)
  rejects(invoice({ kind: "credit_note", dueDate: null, precedingInvoice: { id: " ", issueDate: "2026-09-01" } }), /BT-25/u)
  rejects(invoice({ kind: "credit_note", dueDate: null, precedingInvoice: { id: "QWBE 41", issueDate: "2026-02-30" } }), /BT-26/u)
})

void test("refuses dates that look right but are not real days", () => {
  rejects(invoice({ issueDate: "2026-02-30" }), /BT-2/u)
  rejects(invoice({ issueDate: "17-09-2026" }), /BT-2/u)
  rejects(invoice({ dueDate: "2026-13-01" }), /BT-9/u)
})

void test("refuses a currency other than RON, because nothing converts it yet", () => {
  rejects(invoice({ currencyCode: "EUR" }), /only RON is supported/u)
})

void test("requires an address the Romanian rules can accept", () => {
  rejects(invoice({ seller: { ...seller, address: { ...seller.address, countrySubentity: "Cluj" } } }), /ISO 3166-2/u)
  rejects(invoice({ buyer: { ...buyer, address: { ...buyer.address, streetName: "  " } } }), /buyer\.address\.streetName is required/u)
  rejects(invoice({ buyer: { ...buyer, address: { ...buyer.address, cityName: "" } } }), /buyer\.address\.cityName is required/u)
})

void test("requires the seller to be identifiable when it is not VAT registered", () => {
  rejects(invoice({ seller: { ...seller, vatIdentifier: null, taxRegistrationIdentifier: null } }), /BR-RO-065/u)
  validateEFacturaDocument(exemptInvoice())
})

const consumer: EFacturaParty = {
  registrationName: "Ion Popescu",
  address: { countryCode: "RO", cityName: "Iași", streetName: "Strada Lăpușneanu 10", countrySubentity: "RO-IS", postalZone: null },
  vatIdentifier: null, taxRegistrationIdentifier: null, legalRegistrationIdentifier: null,
}

void test("requires the buyer to be identifiable, by BT-47 when there is no BT-48", () => {
  rejects(invoice({ buyer: consumer }), /BR-RO-120/u)
  validateEFacturaDocument(invoice({ buyer: { ...consumer, legalRegistrationIdentifier: "0000000000000" } }))
  validateEFacturaDocument(invoice({
    buyer: { ...buyer, vatIdentifier: null, legalRegistrationIdentifier: "87654321" },
  }))
})

void test("collects every problem in one refusal instead of stopping at the first", () => {
  const reported = issues(invoice({ id: "  ", issueDate: "nope", currencyCode: "EUR", payableAmount: "0.00" }))
  assert.ok(reported.length >= 4, JSON.stringify(reported))
})

/**
 * A supply outside the scope of VAT: no percentage anywhere, BT-121 carrying
 * `VATEX-EU-O`, and the Article 310 reference in BT-22 rather than BT-120 —
 * the shape ANAF's technical recommendation prescribes for an issuer that is
 * not registered for VAT.
 */
const notSubjectInvoice = (overrides: Partial<EFacturaDocument> = {}): EFacturaDocument => invoice({
  seller: { ...seller, vatIdentifier: null, taxRegistrationIdentifier: "12345678" },
  // BR-O-02: neither party may state a VAT registration here, so the buyer is
  // identified by BT-47 alone.
  buyer: { ...buyer, vatIdentifier: null, legalRegistrationIdentifier: "87654321" },
  notes: [ARTICLE_310],
  lines: [{ id: "1", name: "Consultanță", quantity: "1.0000", unitCode: "HUR", netAmount: "100.00", unitPrice: "100.00", vatCategory: "O", vatRate: null }],
  taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "O", percent: null, exemptionReason: null, exemptionReasonCode: VATEX_NOT_SUBJECT }],
  taxAmount: "0.00",
  taxInclusiveAmount: "100.00",
  payableAmount: "100.00",
  ...overrides,
})

void test("accepts a document that is not subject to VAT, with no percentage at all", () => {
  validateEFacturaDocument(notSubjectInvoice())
})

void test("refuses an out-of-scope document that still states a VAT registration", () => {
  rejects(notSubjectInvoice({ seller: { ...seller, taxRegistrationIdentifier: "12345678" } }), /BR-O-02/u)
  rejects(notSubjectInvoice({ buyer }), /BR-O-02/u)
})

// The line cites BR-O-05, which forbids BT-152 outright; the breakdown cites
// BR-48, which only stops requiring BT-119 here. Omitting it there is ANAF's
// recommended shape and this product's rule, so the message says so.
void test("refuses category O that carries a VAT rate, zero included", () => {
  rejects(notSubjectInvoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "O", percent: "0.00", exemptionReason: null, exemptionReasonCode: VATEX_NOT_SUBJECT }],
  }), /no VAT rate at all.*\(BR-48\)/u)
  rejects(notSubjectInvoice({
    lines: [{ id: "1", name: "x", quantity: "1.0000", unitCode: "HUR", netAmount: "100.00", unitPrice: "100.00", vatCategory: "O", vatRate: "0.00" }],
  }), /BR-O-05/u)
})

void test("requires VATEX-EU-O on an out-of-scope breakdown", () => {
  rejects(notSubjectInvoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "O", percent: null, exemptionReason: ARTICLE_310, exemptionReasonCode: null }],
  }), /BR-O-10/u)
  rejects(notSubjectInvoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "O", percent: null, exemptionReason: null, exemptionReasonCode: "VATEX-EU-309" }],
  }), /BR-O-10/u)
})

void test("refuses a document that is out of scope and taxed at the same time", () => {
  rejects(notSubjectInvoice({
    lines: [
      { id: "1", name: "a", quantity: "1.0000", unitCode: "HUR", netAmount: "100.00", unitPrice: "100.00", vatCategory: "O", vatRate: null },
      { id: "2", name: "b", quantity: "1.0000", unitCode: "HUR", netAmount: "100.00", unitPrice: "100.00", vatCategory: "S", vatRate: "21.00" },
    ],
    taxSubtotals: [
      { taxableAmount: "100.00", taxAmount: "0.00", category: "O", percent: null, exemptionReason: null, exemptionReasonCode: VATEX_NOT_SUBJECT },
      { taxableAmount: "100.00", taxAmount: "21.00", category: "S", percent: "21.00", exemptionReason: null, exemptionReasonCode: null },
    ],
    lineExtensionAmount: "200.00", taxExclusiveAmount: "200.00", taxAmount: "21.00",
    taxInclusiveAmount: "221.00", payableAmount: "221.00",
  }), /BR-O-11/u)
})

void test("requires a rate on the categories that are defined by one", () => {
  rejects(invoice({
    lines: [{ id: "1", name: "x", quantity: "1.0000", unitCode: "HUR", netAmount: "100.00", unitPrice: "100.00", vatCategory: "S", vatRate: null }],
  }), /lines\[0\] is category S and needs a VAT rate/u)
  rejects(exemptInvoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "E", percent: null, exemptionReason: ARTICLE_310, exemptionReasonCode: null }],
  }), /taxSubtotals\[0\] is category E and needs a VAT rate/u)
})

void test("requires a due date when there is money to pay, and checks the VAT arithmetic", () => {
  rejects(invoice({ dueDate: null }), /BR-CO-25/u)
  rejects(invoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "21.01", category: "S", percent: "21.00", exemptionReason: null, exemptionReasonCode: null }],
    taxAmount: "21.01", taxInclusiveAmount: "121.01", payableAmount: "121.01",
  }), /BR-CO-17/u)
  rejects(exemptInvoice({
    lines: [{ id: "1", name: "x", quantity: "1.0000", unitCode: "HUR", netAmount: "100.00", unitPrice: "100.00", vatCategory: "E", vatRate: "0.00" }],
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "5.00", category: "E", percent: "0.00", exemptionReason: ARTICLE_310, exemptionReasonCode: null }],
    taxAmount: "5.00", taxInclusiveAmount: "105.00", payableAmount: "105.00",
  }), /BR-E-09/u)
  // 99.00 at 21% is 20.79 exactly; the half-up rounding must not drift a cent.
  validateEFacturaDocument(invoice({
    lines: [{ id: "1", name: "x", quantity: "1.0000", unitCode: "HUR", netAmount: "99.00", unitPrice: "99.00", vatCategory: "S", vatRate: "21.00" }],
    taxSubtotals: [{ taxableAmount: "99.00", taxAmount: "20.79", category: "S", percent: "21.00", exemptionReason: null, exemptionReasonCode: null }],
    lineExtensionAmount: "99.00", taxExclusiveAmount: "99.00", taxAmount: "20.79",
    taxInclusiveAmount: "119.79", payableAmount: "119.79",
  }))
})

void test("holds each VAT breakdown to the lines that belong to it", () => {
  rejects(invoice({
    lines: [
      { id: "1", name: "a", quantity: "1.0000", unitCode: "H87", netAmount: "40.00", unitPrice: "40.00", vatCategory: "S", vatRate: "21.00" },
      { id: "2", name: "b", quantity: "1.0000", unitCode: "H87", netAmount: "60.00", unitPrice: "60.00", vatCategory: "S", vatRate: "11.00" },
    ],
    taxSubtotals: [
      { taxableAmount: "50.00", taxAmount: "10.50", category: "S", percent: "21.00", exemptionReason: null, exemptionReasonCode: null },
      { taxableAmount: "50.00", taxAmount: "5.50", category: "S", percent: "11.00", exemptionReason: null, exemptionReasonCode: null },
    ],
    taxAmount: "16.00", taxInclusiveAmount: "116.00", payableAmount: "116.00",
  }), /BR-S-08/u)
  rejects(invoice({
    taxSubtotals: [
      { taxableAmount: "100.00", taxAmount: "21.00", category: "S", percent: "21.00", exemptionReason: null, exemptionReasonCode: null },
      { taxableAmount: "0.00", taxAmount: "0.00", category: "S", percent: "11.00", exemptionReason: null, exemptionReasonCode: null },
    ],
  }), /describes VAT group S at rate 11\.00, which no line belongs to/u)
})

void test("refuses an identifier that is stated but empty, rather than letting it vanish", () => {
  // The renderer drops an empty element, so a blank identifier would satisfy a
  // rule here and be missing from the XML ANAF reads.
  rejects(invoice({ buyer: { ...buyer, vatIdentifier: "   " } }), /buyer\.vatIdentifier is stated but empty/u)
  rejects(invoice({ seller: { ...seller, legalRegistrationIdentifier: "" } }),
    /seller\.legalRegistrationIdentifier is stated but empty/u)
  rejects(invoice({ buyer: { ...buyer, vatIdentifier: " " } }), /BR-RO-120/u)
  rejects(invoice({ seller: { ...seller, vatIdentifier: " ", taxRegistrationIdentifier: null } }), /BR-RO-065/u)
})

void test("refuses an exemption reason or code that is stated but empty", () => {
  rejects(exemptInvoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "E", percent: "0.00", exemptionReason: ARTICLE_310, exemptionReasonCode: "  " }],
  }), /exemptionReasonCode is stated but empty/u)
  // A blank code does not satisfy BR-E-10 either: nothing would be sent.
  rejects(exemptInvoice({
    taxSubtotals: [{ taxableAmount: "100.00", taxAmount: "0.00", category: "E", percent: "0.00", exemptionReason: null, exemptionReasonCode: " " }],
  }), /BR-E-10/u)
})

void test("holds every text to the CIUS-RO length limit instead of shortening it", () => {
  // The limits are fatal rules in the official Schematron, counted the way
  // XPath counts them: after normalize-space, in characters.
  validateEFacturaDocument(invoice({ notes: ["x".repeat(300)] }))
  validateEFacturaDocument(invoice({ notes: [`a${" ".repeat(400)}b`] }))
  validateEFacturaDocument(invoice({ notes: ["😀".repeat(300)] }))
  rejects(invoice({ notes: ["x".repeat(301)] }),
    /notes\[0\] exceeds 300 characters after normalize-space \(BR-RO-L300\)/u)
  rejects(invoice({ lines: [{ ...standardLine, name: "x".repeat(101) }] }),
    /lines\[0\]\.name exceeds 100 characters after normalize-space \(BR-RO-L100\)/u)
  rejects(invoice({ buyer: { ...buyer, registrationName: "x".repeat(201) } }),
    /buyer\.registrationName exceeds 200 characters/u)
  rejects(invoice({ seller: { ...seller, address: { ...seller.address, cityName: "x".repeat(51) } } }),
    /seller\.address\.cityName exceeds 50 characters/u)
  rejects(invoice({ seller: { ...seller, address: { ...seller.address, streetName: "x".repeat(151) } } }),
    /seller\.address\.streetName exceeds 150 characters/u)
  rejects(invoice({ seller: { ...seller, address: { ...seller.address, postalZone: "x".repeat(21) } } }),
    /seller\.address\.postalZone exceeds 20 characters/u)
})

void test("holds BT-22 to its own occurrence rules", () => {
  validateEFacturaDocument(invoice({ notes: Array.from({ length: 20 }, (_, index) => `nota ${String(index)}`) }))
  rejects(invoice({ notes: Array.from({ length: 21 }, () => "nota") }),
    /a document carries at most 20 notes, got 21 \(BR-RO-A020\)/u)
  // The renderer would emit an empty element rather than dropping it, so a
  // blank note is refused here instead of being sent as a statement nobody made.
  rejects(invoice({ notes: [" \t "] }), /notes\[0\] is stated but empty/u)
})

void test("refuses a document number that names no number, before ANAF does", () => {
  // BR-RO-010 runs ahead of every fiscal rule in the official validator.
  rejects(invoice({ id: "QWBE-FARA-NUMAR" }), /id must contain at least one digit \(BR-RO-010\)/u)
  rejects(invoice({ id: `QWBE ${"9".repeat(200)}` }), /id exceeds 200 characters/u)
})
