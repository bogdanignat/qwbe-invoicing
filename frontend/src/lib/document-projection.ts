import { money, orDash, vatTreatmentLabel } from "./format.ts"
import { eFacturaStatusLabel, invoiceDetailHref } from "./invoice-register-projection.ts"
import { romanianCountyName } from "./romanian-counties.ts"
import type {
  Address, BuyerSnapshot, CorrectionDocument, DocumentLine, IssuedInvoice, IssuerSnapshot,
  VatBreakdownEntry,
} from "./document-snapshot.ts"

export interface LabelledValue {
  readonly label: string
  readonly value: string
}

export interface PartyView {
  readonly heading: string
  readonly name: string
  readonly details: ReadonlyArray<string>
}

export interface DocumentLineView {
  readonly key: string
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly vat: string
  readonly totalExcludingVat: string
  readonly vatAmount: string
  readonly totalIncludingVat: string
}

export interface VatRowView {
  readonly key: string
  readonly rate: string
  readonly base: string
  readonly amount: string
  readonly note: string
}

export interface DocumentSnapshotView {
  readonly heading: string
  readonly facts: ReadonlyArray<LabelledValue>
  readonly parties: ReadonlyArray<PartyView>
  readonly lines: ReadonlyArray<DocumentLineView>
  readonly vatRows: ReadonlyArray<VatRowView>
  readonly totals: ReadonlyArray<LabelledValue>
  readonly notes: string | null
  readonly originalInvoice: { readonly label: string; readonly href: string } | null
}

/**
 * The address as the legacy document prints it: names, not codes.
 *
 * `county` is stored as an ISO 3166-2 code (`RO-B`, `RO-BT`) because that is
 * what `validateParty` accepts, so it is resolved to its name here. The order
 * follows the legacy `formattedRomanianAddress` — street, city, county, sector,
 * postal code, country — and parts the snapshot does not carry are dropped
 * rather than printed as empty separators.
 */
const addressLine = (address: Address): string => [
  address.street,
  address.city,
  romanianCountyName(address.county),
  address.sector === undefined ? undefined : `Sector ${String(address.sector)}`,
  address.postalCode,
  address.countryCode,
].filter((part): part is string => part !== undefined && part !== "").join(", ")

const vatNote = (registered: boolean): string => registered ? "Plătitor de TVA" : "Neplătitor de TVA"

/**
 * The issuer block, empty optional fields omitted and the VAT code spelled out.
 *
 * `iban`, `bankName`, `socialCapital` and `tradeRegistryNumber` are all allowed
 * to be `""` by `normalizedIssuerDetails`, and an absent IBAN must read as
 * absent rather than as the label with nothing after it. The VAT code is the
 * fiscal identifier prefixed with `RO` — the identifier itself is stored as
 * bare digits (`isValidRomanianCui`), so the prefix is added exactly once and
 * only for an issuer the snapshot recorded as VAT registered.
 */
const issuerView = (issuer: IssuerSnapshot): PartyView => ({
  heading: "Furnizor",
  name: issuer.name,
  details: [
    `Formă juridică ${issuer.legalForm.toUpperCase()}`,
    issuer.fiscalIdentifier === "" ? undefined : `CUI / CIF ${issuer.fiscalIdentifier}`,
    issuer.vatRegistered && issuer.fiscalIdentifier !== ""
      ? `Cod TVA RO${issuer.fiscalIdentifier}`
      : vatNote(issuer.vatRegistered),
    issuer.tradeRegistryNumber === "" ? undefined : `Nr. Reg. Com. ${issuer.tradeRegistryNumber}`,
    issuer.socialCapital === "" ? undefined : `Capital social ${issuer.socialCapital} RON`,
    issuer.iban === "" ? undefined : `IBAN ${issuer.iban}`,
    issuer.bankName === "" ? undefined : `Bancă ${issuer.bankName}`,
    addressLine(issuer.address),
  ].filter((detail): detail is string => detail !== undefined),
})

const customerView = (customer: BuyerSnapshot): PartyView => ({
  heading: "Cumpărător",
  name: customer.name,
  details: [
    customer.partyType === "company" ? "Persoană juridică" : "Persoană fizică",
    `${customer.partyType === "company" ? "CUI" : "CNP"} ${orDash(customer.fiscalIdentifier)}`,
    addressLine(customer.address),
    vatNote(customer.vatRegistered),
  ],
})

const lineView = (line: DocumentLine, currency: string): DocumentLineView => ({
  key: line.id,
  description: line.description,
  quantity: `${line.quantity} ${line.unitOfMeasure.name} (${line.unitOfMeasure.code})`,
  unitPrice: money(line.unitPrice, currency),
  vat: vatTreatmentLabel({ vatCategoryCode: line.vatCategoryCode, rate: line.vatRate }),
  totalExcludingVat: money(line.totalExcludingVat, currency),
  vatAmount: money(line.vatAmount, currency),
  totalIncludingVat: money(line.totalIncludingVat, currency),
})

// The key pairs category with rate, as legacy does: `code` alone is not
// guaranteed unique across a breakdown that can carry the same code twice.
const vatRowView = (entry: VatBreakdownEntry, currency: string): VatRowView => ({
  key: `${entry.vatCategoryCode}-${entry.rate}`,
  rate: vatTreatmentLabel({ vatCategoryCode: entry.vatCategoryCode, rate: entry.rate }),
  base: money(entry.vatBaseAmount, currency),
  amount: money(entry.vatAmount, currency),
  note: orDash(entry.vatExemptionReason),
})

const totals = (
  document: { readonly totalExcludingVat: string; readonly vatTotal: string; readonly totalIncludingVat: string; readonly currency: string },
): ReadonlyArray<LabelledValue> => [
  { label: "Total fără TVA", value: money(document.totalExcludingVat, document.currency) },
  { label: "TVA", value: money(document.vatTotal, document.currency) },
  { label: "Total cu TVA", value: money(document.totalIncludingVat, document.currency) },
]

const body = (
  document: IssuedInvoice | CorrectionDocument,
): Pick<DocumentSnapshotView, "heading" | "parties" | "lines" | "vatRows" | "totals"> => ({
  heading: `${document.series} ${String(document.number)}`,
  parties: [issuerView(document.issuer), customerView(document.customer)],
  lines: document.lines.map((line) => lineView(line, document.currency)),
  vatRows: document.vatBreakdown.map((entry) => vatRowView(entry, document.currency)),
  totals: totals(document),
})

export const projectIssuedInvoice = (invoice: IssuedInvoice): DocumentSnapshotView => ({
  ...body(invoice),
  facts: [
    { label: "Emisă", value: invoice.issueDate },
    { label: "Scadență", value: orDash(invoice.dueDate) },
    { label: "Monedă", value: invoice.currency },
    { label: "e-Factura", value: eFacturaStatusLabel(invoice.eFacturaStatus) },
  ],
  notes: invoice.notes,
  originalInvoice: null,
})

/**
 * A correction keeps the negative sign the register stored it with.
 *
 * Its totals are not re-derived here — they arrive already signed from the
 * backend, and flipping or absolutizing them for display would misstate a
 * fiscal document.
 */
export const projectCorrectionDocument = (correction: CorrectionDocument): DocumentSnapshotView => ({
  ...body(correction),
  facts: [
    { label: "Emisă", value: correction.issueDate },
    { label: "Monedă", value: correction.currency },
    { label: "Motiv", value: correction.reason },
  ],
  notes: null,
  originalInvoice: {
    label: "Vezi factura inițială",
    href: invoiceDetailHref(correction.originalInvoiceId),
  },
})
