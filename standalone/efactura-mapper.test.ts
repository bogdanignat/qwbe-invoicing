import assert from "node:assert/strict"
import test from "node:test"

import { EFacturaContractViolation } from "../cube/efactura/index.ts"
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
  // BG-16 has no source in the snapshot, so it is omitted rather than guessed.
  assert.equal(mapped.paymentMeans, null)
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
  assert.equal(mapped.note, "Stornare integrală: servicii nelivrate")
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
