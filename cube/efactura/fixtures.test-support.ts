import type { EFacturaDocument, EFacturaLine, EFacturaParty, EFacturaTaxSubtotal } from "./contracts/document.ts"
import { ANONYMOUS_BUYER_IDENTIFIER } from "./profile.ts"
import { VATEX_NOT_SUBJECT } from "./vat-rules.ts"

/**
 * Synthetic documents covering every shape the generator can emit.
 *
 * They exist to be fed to the official ANAF validator, so **every value here is
 * invented**: the identifiers are structurally plausible — the CUIs carry a
 * valid check digit, because the validator refuses a malformed one before it
 * ever reaches the fiscal rules — and belong to nobody.
 *
 * Each fixture isolates one question, so a rejection names its own cause. All
 * eight were accepted by the official validator on 2026-09-17:
 *
 * | Fixture | Question it answers |
 * | --- | --- |
 * | 01 | the plain rated B2B path |
 * | 02 | a consumer identified by the placeholder BT-47 (BR-RO-120) |
 * | 03 | `SECTOR3` as BT-52 with `RO-B` as BT-54 |
 * | 04 | Article 310 as category `E`, the way the repository does it |
 * | 05 | Article 310 as category `O`, the way ANAF recommends |
 * | 06 | a credit note with no payment due date |
 * | 07 | a consumer identified by a CNP instead of the placeholder |
 * | 08 | a buyer company without a VAT registration, on BT-47 alone |
 *
 * They are the regression set for the profile constants: re-uploading them
 * after a change to `profile.ts` or `ubl.ts` is what says the change is safe.
 */

const ARTICLE_310 = "Regim special de scutire conform art. 310 din Codul fiscal"

const vatRegisteredSeller: EFacturaParty = {
  registrationName: "Exemplu Software SRL",
  address: {
    countryCode: "RO", cityName: "Cluj-Napoca", streetName: "Strada Exemplului 10",
    countrySubentity: "RO-CJ", postalZone: "400001",
  },
  vatIdentifier: "RO19999919",
  taxRegistrationIdentifier: null,
  legalRegistrationIdentifier: "J12/9999/2020",
}

/** An Article 310 issuer: a CUI, but no VAT identifier (BR-RO-065, BT-32). */
const unregisteredSeller: EFacturaParty = {
  registrationName: "Exemplu Consultanta SRL",
  address: {
    countryCode: "RO", cityName: "Iasi", streetName: "Strada Exemplului 2",
    countrySubentity: "RO-IS", postalZone: "700001",
  },
  vatIdentifier: null,
  taxRegistrationIdentifier: "19999927",
  legalRegistrationIdentifier: "J22/9999/2021",
}

const companyBuyer: EFacturaParty = {
  registrationName: "Exemplu Client SRL",
  address: {
    countryCode: "RO", cityName: "Timisoara", streetName: "Bulevardul Exemplului 30",
    countrySubentity: "RO-TM", postalZone: "300001",
  },
  vatIdentifier: "RO19999935",
  taxRegistrationIdentifier: null,
  legalRegistrationIdentifier: "19999935",
}

/** BR-O-02 forbids a buyer VAT identifier on a document that uses category `O`,
 * so the same company is identified by BT-47 alone there. */
const companyBuyerWithoutVatId: EFacturaParty = {
  ...companyBuyer,
  vatIdentifier: null,
}

/** A buyer that is a company but not VAT registered: no BT-48 exists to give,
 * so BR-RO-120 can only be met through BT-47. */
const unregisteredCompanyBuyer: EFacturaParty = {
  ...companyBuyer,
  registrationName: "Exemplu Mic SRL",
  vatIdentifier: null,
  legalRegistrationIdentifier: "19999951",
}

/** For Bucharest the sector occupies BT-52, not the county field. */
const bucharestBuyer: EFacturaParty = {
  ...companyBuyer,
  registrationName: "Exemplu Capitala SRL",
  vatIdentifier: "RO19999943",
  legalRegistrationIdentifier: "19999943",
  address: {
    countryCode: "RO", cityName: "SECTOR3", streetName: "Calea Exemplului 100",
    countrySubentity: "RO-B", postalZone: "030001",
  },
}

const individualBuyer: EFacturaParty = {
  registrationName: "Ionescu Exemplu",
  address: {
    countryCode: "RO", cityName: "Brasov", streetName: "Strada Exemplului 7",
    countrySubentity: "RO-BV", postalZone: null,
  },
  vatIdentifier: null,
  taxRegistrationIdentifier: null,
  legalRegistrationIdentifier: ANONYMOUS_BUYER_IDENTIFIER,
}

const line = (id: string, name: string, quantity: string, unitCode: string, unitPrice: string,
  netAmount: string, vatCategory: EFacturaLine["vatCategory"], vatRate: string | null): EFacturaLine =>
  ({ id, name, quantity, unitCode, netAmount, unitPrice, vatCategory, vatRate })

const subtotal = (taxableAmount: string, taxAmount: string, category: EFacturaTaxSubtotal["category"],
  percent: string | null, exemptionReason: string | null,
  exemptionReasonCode: string | null): EFacturaTaxSubtotal =>
  ({ taxableAmount, taxAmount, category, percent, exemptionReason, exemptionReasonCode })

const base = {
  kind: "invoice",
  issueDate: "2026-09-17",
  dueDate: "2026-10-17",
  currencyCode: "RON",
  note: null,
  precedingInvoice: null,
  paymentMeans: null,
} as const

/** Standard rated, two rates, company to company. */
export const standardB2B: EFacturaDocument = {
  ...base,
  id: "QWBE 1001",
  seller: vatRegisteredSeller,
  buyer: companyBuyer,
  lines: [
    line("1", "Servicii de consultanta software", "10.0000", "HUR", "150.00", "1500.00", "S", "21.00"),
    line("2", "Manual tiparit", "4.0000", "H87", "25.00", "100.00", "S", "11.00"),
  ],
  taxSubtotals: [
    subtotal("1500.00", "315.00", "S", "21.00", null, null),
    subtotal("100.00", "11.00", "S", "11.00", null, null),
  ],
  lineExtensionAmount: "1600.00",
  taxExclusiveAmount: "1600.00",
  taxAmount: "326.00",
  taxInclusiveAmount: "1926.00",
  payableAmount: "1926.00",
}

/** Standard rated, sold to a private individual identified by a placeholder. */
export const standardB2C: EFacturaDocument = {
  ...standardB2B,
  id: "QWBE 1002",
  buyer: individualBuyer,
  lines: [line("1", "Abonament lunar", "1.0000", "MON", "99.00", "99.00", "S", "21.00")],
  taxSubtotals: [subtotal("99.00", "20.79", "S", "21.00", null, null)],
  lineExtensionAmount: "99.00",
  taxExclusiveAmount: "99.00",
  taxAmount: "20.79",
  taxInclusiveAmount: "119.79",
  payableAmount: "119.79",
}

/** The same consumer sale, identified by a CNP instead. Kept separate so the
 * validator says which identifier it wants, rather than us assuming. */
export const consumerWithCnp: EFacturaDocument = {
  ...standardB2C,
  id: "QWBE 1007",
  buyer: { ...individualBuyer, legalRegistrationIdentifier: "1960101221141" },
}

/** A Bucharest buyer, to confirm how the sector is expected in BT-52/BT-54. */
export const bucharestBuyerInvoice: EFacturaDocument = {
  ...standardB2C,
  id: "QWBE 1003",
  buyer: bucharestBuyer,
}

/** A rated sale to a company with no VAT registration of its own. */
export const saleToUnregisteredCompany: EFacturaDocument = {
  ...standardB2C,
  id: "QWBE 1008",
  buyer: unregisteredCompanyBuyer,
}

/** Article 310 rendered the way the repository does it today: category `E`,
 * zero percent, legal reference as BT-120 text. */
export const article310AsExempt: EFacturaDocument = {
  ...base,
  id: "QWBE 1004",
  seller: unregisteredSeller,
  buyer: companyBuyer,
  lines: [line("1", "Servicii de consultanta", "5.0000", "HUR", "120.00", "600.00", "E", "0.00")],
  taxSubtotals: [subtotal("600.00", "0.00", "E", "0.00", ARTICLE_310, null)],
  lineExtensionAmount: "600.00",
  taxExclusiveAmount: "600.00",
  taxAmount: "0.00",
  taxInclusiveAmount: "600.00",
  payableAmount: "600.00",
}

/** Article 310 rendered the way ANAF's technical recommendation prescribes:
 * category `O`, no percent at all, BT-121 = VATEX-EU-O, legal reference in
 * BT-22 (BR-RO-060). The buyer keeps its CUI but loses BT-48, which BR-O-02
 * forbids on a document that is not subject to VAT. */
export const article310AsNotSubject: EFacturaDocument = {
  ...article310AsExempt,
  id: "QWBE 1005",
  note: ARTICLE_310,
  buyer: companyBuyerWithoutVatId,
  lines: [line("1", "Servicii de consultanta", "5.0000", "HUR", "120.00", "600.00", "O", null)],
  taxSubtotals: [subtotal("600.00", "0.00", "O", null, null, VATEX_NOT_SUBJECT)],
}

/** A full reversal of `standardB2B`, in the positive amounts UBL expects. */
export const fullCreditNote: EFacturaDocument = {
  ...standardB2B,
  kind: "credit_note",
  id: "QWBE-STORNO 7",
  dueDate: null,
  note: "Stornare integrala a facturii QWBE 1001",
  precedingInvoice: { id: standardB2B.id, issueDate: standardB2B.issueDate },
}

export interface EFacturaFixture {
  readonly name: string
  readonly document: EFacturaDocument
}

export const syntheticFixtures: ReadonlyArray<EFacturaFixture> = [
  { name: "01-standard-b2b", document: standardB2B },
  { name: "02-consumer-placeholder-id", document: standardB2C },
  { name: "03-bucharest-buyer", document: bucharestBuyerInvoice },
  { name: "04-article310-exempt-E", document: article310AsExempt },
  { name: "05-article310-not-subject-O", document: article310AsNotSubject },
  { name: "06-credit-note", document: fullCreditNote },
  { name: "07-consumer-cnp", document: consumerWithCnp },
  { name: "08-buyer-without-vat-registration", document: saleToUnregisteredCompany },
]
