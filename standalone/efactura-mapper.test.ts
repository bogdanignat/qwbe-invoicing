import assert from "node:assert/strict"
import test from "node:test"

import { EFacturaContractViolation, renderEFacturaXml } from "../cube/efactura/index.ts"
import type { CorrectionDocument, DraftLine, IssuedInvoice } from "../cube/invoicing/index.ts"
import { documentNumber, mapCorrection, mapIssuedInvoice } from "./efactura-mapper.ts"

const line: DraftLine = {
  id: "line-1",
  description: "Servicii de consultanță",
  quantity: "2.0000",
  unitPrice: "150.00",
  unitOfMeasure: { code: "HUR", name: "oră" },
  vatRateCode: "RO_STANDARD",
  vatRate: "21.00",
  vatCategoryCode: "S",
  vatExemptionReason: null,
  totalExcludingVat: "300.00",
  vatAmount: "63.00",
  totalIncludingVat: "363.00",
}

const issuer = {
  branding: null,
  vatRegistered: true,
  legalForm: "srl",
  tradeRegistryNumber: "J22/123/2020",
  iban: "RO49AAAA1B31007593840000",
  bankName: "Banca Exemplu",
  socialCapital: "200.00",
  name: "Exemplu Software SRL",
  fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "Botoșani", street: "Strada Exemplului 1", county: "RO-BT" },
} as const

const invoice: IssuedInvoice = {
  id: "invoice-1",
  organizationId: "org-1",
  draftId: null,
  sourceProformaId: null,
  eFacturaStatus: "not_sent",
  series: "QWBE",
  number: 7,
  issueDate: "2026-09-01",
  dueDate: "2026-09-16",
  issuedAt: "2026-09-01T10:00:00.000Z",
  actorId: "user-1",
  currency: "RON",
  notes: null,
  issuer,
  customer: {
    partyType: "company",
    vatRegistered: true,
    name: "Exemplu Client SRL",
    fiscalIdentifier: "87654329",
    address: { countryCode: "RO", city: "Iași", street: "Șoseaua Exemplului 2", county: "RO-IS" },
  },
  lines: [line],
  vatBreakdown: [{ code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null,
    vatBaseAmount: "300.00", vatAmount: "63.00" }],
  totalExcludingVat: "300.00",
  vatTotal: "63.00",
  totalIncludingVat: "363.00",
}

const negated = (value: string): string => `-${value}`

const correction: CorrectionDocument = {
  id: "correction-1",
  organizationId: "org-1",
  originalInvoiceId: "invoice-1",
  fiscalYear: 2026,
  series: "QWBE-STORNO",
  number: 3,
  issueDate: "2026-09-20",
  issuedAt: "2026-09-20T10:00:00.000Z",
  reason: "Stornare integrală: servicii nelivrate",
  actorId: "user-1",
  currency: "RON",
  issuer,
  customer: invoice.customer,
  lines: [{
    ...line,
    id: "correction-line-1",
    totalExcludingVat: negated(line.totalExcludingVat),
    vatAmount: negated(line.vatAmount),
    totalIncludingVat: negated(line.totalIncludingVat),
  }],
  vatBreakdown: [{ code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null,
    vatBaseAmount: "-300.00", vatAmount: "-63.00" }],
  totalExcludingVat: "-300.00",
  vatTotal: "-63.00",
  totalIncludingVat: "-363.00",
}

void test("names the document exactly as the printed invoice does", () => {
  assert.equal(documentNumber(invoice), "QWBE 7")
  assert.equal(mapIssuedInvoice(invoice).id, "QWBE 7")
})

void test("maps an issued invoice without recomputing any of its amounts", () => {
  const mapped = mapIssuedInvoice(invoice)
  assert.equal(mapped.kind, "invoice")
  assert.equal(mapped.lineExtensionAmount, "300.00")
  assert.equal(mapped.taxAmount, "63.00")
  assert.equal(mapped.payableAmount, "363.00")
  assert.deepEqual(mapped.lines.map((mappedLine) => mappedLine.id), ["1"])
  assert.equal(mapped.lines[0]?.unitCode, "HUR")
  assert.equal(mapped.precedingInvoice, null)
})

void test("derives the VAT prefix without doubling one that is already stored", () => {
  assert.equal(mapIssuedInvoice(invoice).seller.vatIdentifier, "RO12345674")
  const prefixed = mapIssuedInvoice({ ...invoice, issuer: { ...issuer, fiscalIdentifier: "RO12345674" } })
  assert.equal(prefixed.seller.vatIdentifier, "RO12345674")
})

void test("identifies an Article 310 seller by its tax registration, not a VAT number", () => {
  const mapped = mapIssuedInvoice({ ...invoice, issuer: { ...issuer, vatRegistered: false } })
  assert.equal(mapped.seller.vatIdentifier, null)
  assert.equal(mapped.seller.taxRegistrationIdentifier, "12345674")
  assert.equal(mapped.seller.legalRegistrationIdentifier, "J22/123/2020")
})

void test("names a buyer company by its CUI, whether or not it is VAT registered", () => {
  assert.equal(mapIssuedInvoice(invoice).buyer.vatIdentifier, "RO87654329")
  assert.equal(mapIssuedInvoice(invoice).buyer.legalRegistrationIdentifier, "87654329")
  // BT-32 is seller-only, so BT-47 is the buyer's only identifier here.
  const unregistered = mapIssuedInvoice({
    ...invoice,
    customer: { ...invoice.customer, vatRegistered: false },
  })
  assert.equal(unregistered.buyer.vatIdentifier, null)
  assert.equal(unregistered.buyer.taxRegistrationIdentifier, null)
  assert.equal(unregistered.buyer.legalRegistrationIdentifier, "87654329")
})

const individualCustomer = {
  partyType: "individual", vatRegistered: false, name: "Ionescu Exemplu", fiscalIdentifier: "1960101221141",
  address: { countryCode: "RO", city: "Brașov", street: "Strada Exemplului 7", county: "RO-BV" },
} as const

const consumerInvoice = (fiscalIdentifier: string): IssuedInvoice =>
  ({ ...invoice, customer: { ...individualCustomer, fiscalIdentifier } })

void test("identifies a consumer by the CNP the invoice was issued with", () => {
  const mapped = mapIssuedInvoice({ ...invoice, customer: individualCustomer })
  assert.equal(mapped.buyer.vatIdentifier, null)
  assert.equal(mapped.buyer.taxRegistrationIdentifier, null)
  assert.equal(mapped.buyer.legalRegistrationIdentifier, "1960101221141")
})

void test("falls back to the anonymous identifier when there is no usable CNP", () => {
  // BR-RO-120 wants a buyer identifier and the only one a consumer has is a
  // CNP, which is optional here. A CNP that fails its own check digit names
  // nobody, so it is treated exactly like an absent one rather than exported.
  for (const stored of ["", "   ", "1960101221144", "196010122114"]) {
    const mapped = mapIssuedInvoice(consumerInvoice(stored))
    assert.equal(mapped.buyer.legalRegistrationIdentifier, "0000000000000", stored)
    assert.ok(!JSON.stringify(mapped).includes(stored.trim() || "no-such-value"), stored)
  }
})

void test("puts a Bucharest sector where the city name belongs", () => {
  const mapped = mapIssuedInvoice({
    ...invoice,
    customer: { ...invoice.customer,
      address: { countryCode: "RO", city: "București", street: "Calea Exemplului 100", county: "RO-B", sector: 3 } },
  })
  assert.equal(mapped.buyer.address.cityName, "SECTOR3")
  assert.equal(mapped.buyer.address.countrySubentity, "RO-B")
})

void test("maps a correction to a credit note in positive amounts", () => {
  const mapped = mapCorrection(correction, invoice)
  assert.equal(mapped.kind, "credit_note")
  assert.equal(mapped.id, "QWBE-STORNO 3")
  assert.equal(mapped.dueDate, null)
  assert.deepEqual(mapped.precedingInvoice, { id: "QWBE 7", issueDate: "2026-09-01" })
  assert.deepEqual(mapped.notes, ["Stornare integrală: servicii nelivrate"])
  assert.equal(mapped.lineExtensionAmount, "300.00")
  assert.equal(mapped.taxAmount, "63.00")
  assert.equal(mapped.payableAmount, "363.00")
  const amounts = [mapped.taxExclusiveAmount, mapped.taxInclusiveAmount,
    ...mapped.lines.flatMap((mappedLine) => [mappedLine.netAmount, mappedLine.unitPrice, mappedLine.quantity]),
    ...mapped.taxSubtotals.flatMap((subtotal) => [subtotal.taxableAmount, subtotal.taxAmount])]
  assert.ok(amounts.every((value) => !value.startsWith("-")), JSON.stringify(amounts))
})

const refuses = (run: () => unknown, pattern: RegExp): void => {
  try {
    run()
  } catch (error) {
    assert.ok(error instanceof EFacturaContractViolation, String(error))
    assert.ok(error.issues.some((issue) => pattern.test(issue)), JSON.stringify(error.issues))
    return
  }
  assert.fail("expected the mapping to be refused")
}

void test("refuses a correction that does not belong to the invoice it is given", () => {
  refuses(() => mapCorrection(correction, { ...invoice, id: "invoice-2" }), /not the one this correction reverses/u)
  refuses(() => mapCorrection(correction, { ...invoice, organizationId: "org-2" }), /different organizations/u)
})

void test("refuses a correction whose amounts are not negative, instead of silently flipping them", () => {
  refuses(() => mapCorrection({ ...correction, totalIncludingVat: "363.00" }, invoice),
    /totalIncludingVat is expected to be negative/u)
})

void test("refuses a correction that does not reverse the invoice exactly", () => {
  refuses(() => mapCorrection({
    ...correction,
    lines: correction.lines.map((corrected) => ({ ...corrected, description: "Altceva" })),
  }, invoice), /does not reverse the original invoice exactly/u)
})

const ARTICLE_310 = "Regim special de scutire conform art. 310 din Codul fiscal"

const article310Line: DraftLine = {
  ...line, vatRateCode: "RO_NON_VAT", vatRate: "0.00", vatCategoryCode: "O",
  vatExemptionReason: ARTICLE_310, vatAmount: "0.00", totalIncludingVat: "300.00",
}

/** An Article 310 seller is not VAT registered and every line it issues is `O`:
 * a document mixing the two treatments could not be issued, so none is built. */
const article310Invoice: IssuedInvoice = {
  ...invoice,
  issuer: { ...issuer, vatRegistered: false },
  lines: [article310Line],
  vatBreakdown: [{ code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "O", vatExemptionReason: ARTICLE_310,
    vatBaseAmount: "300.00", vatAmount: "0.00" }],
  totalExcludingVat: "300.00",
  vatTotal: "0.00",
  totalIncludingVat: "300.00",
}

const article310Correction: CorrectionDocument = {
  ...correction,
  issuer: { ...issuer, vatRegistered: false },
  lines: [{ ...article310Line, id: "correction-line-1", totalExcludingVat: "-300.00",
    vatAmount: "-0.00", totalIncludingVat: "-300.00" }],
  vatBreakdown: [{ code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "O", vatExemptionReason: ARTICLE_310,
    vatBaseAmount: "-300.00", vatAmount: "-0.00" }],
  totalExcludingVat: "-300.00",
  vatTotal: "-0.00",
  totalIncludingVat: "-300.00",
}

void test("renders an Article 310 invoice as not subject to VAT, with no percentage anywhere", () => {
  const mapped = mapIssuedInvoice(article310Invoice)
  assert.equal(mapped.lines[0]?.vatRate, null)
  assert.deepEqual(mapped.taxSubtotals, [{ taxableAmount: "300.00", taxAmount: "0.00", category: "O",
    percent: null, exemptionReason: null, exemptionReasonCode: "VATEX-EU-O" }])
  // The legal ground moves from BT-120 to BT-22, where ANAF's recommendation puts it.
  assert.deepEqual(mapped.notes, [ARTICLE_310])
  const xml = renderEFacturaXml(mapped)
  assert.equal(xml.includes("cbc:Percent"), false, xml)
  assert.equal(xml.includes("cbc:TaxExemptionReason>"), false, xml)
  assert.ok(xml.includes("<cbc:TaxExemptionReasonCode>VATEX-EU-O</cbc:TaxExemptionReasonCode>"), xml)
  assert.ok(xml.includes(`<cbc:Note>${ARTICLE_310}</cbc:Note>`), xml)
})

void test("drops a VAT-registered buyer's VAT identifier on an Article 310 document", () => {
  // BR-O-02. The buyer here is VAT registered, and on any other invoice would
  // carry BT-48; the seller's treatment, not the buyer's status, decides.
  assert.equal(article310Invoice.customer.vatRegistered, true)
  const mapped = mapIssuedInvoice(article310Invoice)
  assert.equal(mapped.buyer.vatIdentifier, null)
  assert.equal(mapped.buyer.legalRegistrationIdentifier, "87654329")
  assert.equal(mapped.seller.vatIdentifier, null)
  assert.equal(mapped.seller.taxRegistrationIdentifier, "12345674")
  assert.equal(renderEFacturaXml(mapped).includes("RO87654329"), false)
})

void test("keeps the seller's own remarks whole beside the legal reference", () => {
  const notes = "Livrare în tranșe & recepție <parțială>.\nGaranție 24 de luni."
  const mapped = mapIssuedInvoice({ ...article310Invoice, notes })
  assert.deepEqual(mapped.notes, [ARTICLE_310, notes])
  const xml = renderEFacturaXml(mapped)
  assert.ok(xml.includes("recepție &lt;parțială&gt;"), xml)
  assert.ok(xml.includes("tranșe &amp; recepție"), xml)
  // Each note has its own 300-character budget (BR-RO-L300), which is why the
  // legal reference never shortens the seller's remarks: the product caps
  // remarks at 300 and the reference is a separate BT-22 occurrence.
  const maximum = mapIssuedInvoice({ ...article310Invoice, notes: "ș".repeat(300) })
  assert.deepEqual(maximum.notes, [ARTICLE_310, "ș".repeat(300)])
  assert.deepEqual(mapIssuedInvoice({ ...article310Invoice, notes: "   " }).notes, [ARTICLE_310])
})

void test("refuses a note longer than one BT-22 may carry", () => {
  // The invoicing domain caps notes at 300, so this shape cannot be issued;
  // the generator still refuses it rather than truncating a fiscal text.
  refuses(() => mapIssuedInvoice({ ...article310Invoice, notes: "ș".repeat(301) }),
    /notes\[1\] exceeds 300 characters after normalize-space \(BR-RO-L300\)/u)
})

void test("states the legal reference once, however many Article 310 lines there are", () => {
  const mapped = mapIssuedInvoice({
    ...article310Invoice,
    lines: [article310Line, { ...article310Line, id: "line-2", description: "Mentenanță" }],
    vatBreakdown: [{ ...article310Invoice.vatBreakdown[0] as (typeof article310Invoice.vatBreakdown)[number],
      vatBaseAmount: "600.00" }],
    totalExcludingVat: "600.00",
    totalIncludingVat: "600.00",
  })
  assert.deepEqual(mapped.notes, [ARTICLE_310])
  assert.equal(mapped.taxSubtotals.length, 1)
  assert.deepEqual(mapped.lines.map((mappedLine) => mappedLine.vatRate), [null, null])
})

void test("carries both the legal reference and the reason on an Article 310 credit note", () => {
  const mapped = mapCorrection(article310Correction, article310Invoice)
  assert.equal(mapped.kind, "credit_note")
  assert.deepEqual(mapped.notes, [ARTICLE_310, "Stornare integrală: servicii nelivrate"])
  assert.deepEqual(mapped.precedingInvoice, { id: "QWBE 7", issueDate: "2026-09-01" })
  assert.equal(mapped.dueDate, null)
  assert.deepEqual(mapped.taxSubtotals.map((subtotal) => [subtotal.percent, subtotal.exemptionReasonCode]),
    [[null, "VATEX-EU-O"]])
  assert.equal(mapped.payableAmount, "300.00")
  const xml = renderEFacturaXml(mapped)
  assert.equal(xml.includes("cbc:DueDate"), false, xml)
  const reference = xml.indexOf(`<cbc:Note>${ARTICLE_310}</cbc:Note>`)
  const storno = xml.indexOf("<cbc:Note>Stornare integrală: servicii nelivrate</cbc:Note>")
  assert.ok(reference !== -1 && storno > reference, xml)
})

void test("leaves a taxed document exactly as it was", () => {
  const mapped = mapIssuedInvoice(invoice)
  assert.deepEqual(mapped.notes, [])
  assert.equal(mapped.lines[0]?.vatRate, "21.00")
  assert.deepEqual(mapped.taxSubtotals, [{ taxableAmount: "300.00", taxAmount: "63.00", category: "S",
    percent: "21.00", exemptionReason: null, exemptionReasonCode: null }])
  assert.equal(mapped.buyer.vatIdentifier, "RO87654329")
  assert.deepEqual(mapCorrection(correction, invoice).notes, ["Stornare integrală: servicii nelivrate"])
})
