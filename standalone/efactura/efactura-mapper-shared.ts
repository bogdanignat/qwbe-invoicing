import type { EFacturaLine, EFacturaParty, EFacturaTaxSubtotal } from "../../cube/efactura/index.ts"
import { ANONYMOUS_BUYER_IDENTIFIER, VATEX_NOT_SUBJECT } from "../../cube/efactura/index.ts"
import type { Address, BuyerSnapshot, DraftLine, IssuerCompanySnapshot, VatBreakdown } from "../../cube/invoicing/index.ts"
import { isValidRomanianCnp } from "../../cube/invoicing/index.ts"

export const documentNumber = (document: { readonly series: string; readonly number: number }): string =>
  `${document.series} ${String(document.number)}`

const vatIdentifier = (fiscalIdentifier: string): string =>
  `RO${fiscalIdentifier.trim().replace(/^RO/iu, "")}`

const address = (source: Address) => ({
  countryCode: source.countryCode,
  cityName: source.county === "RO-B" && source.sector !== undefined ? `SECTOR${String(source.sector)}` : source.city,
  streetName: source.street,
  countrySubentity: source.county,
  postalZone: source.postalCode ?? null,
})

export const seller = (issuer: IssuerCompanySnapshot): EFacturaParty => ({
  registrationName: issuer.name,
  address: address(issuer.address),
  vatIdentifier: issuer.vatRegistered ? vatIdentifier(issuer.fiscalIdentifier) : null,
  taxRegistrationIdentifier: issuer.vatRegistered ? null : issuer.fiscalIdentifier.trim() || null,
  legalRegistrationIdentifier: issuer.tradeRegistryNumber.trim() || null,
})

const consumerIdentifier = (fiscalIdentifier: string): string => {
  const cnp = fiscalIdentifier.trim()
  return isValidRomanianCnp(cnp) ? cnp : ANONYMOUS_BUYER_IDENTIFIER
}

export const buyer = (customer: BuyerSnapshot, notSubject: boolean): EFacturaParty => ({
  registrationName: customer.name,
  address: address(customer.address),
  vatIdentifier: !notSubject && customer.partyType === "company" && customer.vatRegistered
    ? vatIdentifier(customer.fiscalIdentifier) : null,
  taxRegistrationIdentifier: null,
  legalRegistrationIdentifier: customer.partyType === "company"
    ? customer.fiscalIdentifier.trim() || null : consumerIdentifier(customer.fiscalIdentifier),
})

export const mapLine = (line: DraftLine, position: number): EFacturaLine => ({
  id: String(position + 1),
  name: line.description,
  quantity: line.quantity,
  unitCode: line.unitOfMeasure.code,
  netAmount: line.totalExcludingVat,
  unitPrice: line.unitPrice,
  vatCategory: line.vatCategoryCode,
  vatRate: line.vatCategoryCode === "O" ? null : line.vatRate,
})

export const mapSubtotal = (breakdown: VatBreakdown): EFacturaTaxSubtotal => ({
  taxableAmount: breakdown.vatBaseAmount,
  taxAmount: breakdown.vatAmount,
  category: breakdown.vatCategoryCode,
  percent: breakdown.vatCategoryCode === "O" ? null : breakdown.rate,
  exemptionReason: breakdown.vatCategoryCode === "O" ? null : breakdown.vatExemptionReason,
  exemptionReasonCode: breakdown.vatCategoryCode === "O" ? VATEX_NOT_SUBJECT : null,
})

export const legalReference = (vatBreakdown: ReadonlyArray<VatBreakdown>): string | null =>
  vatBreakdown.find((breakdown) => breakdown.vatCategoryCode === "O")?.vatExemptionReason ?? null

export const documentNotes = (reference: string | null, own: string | null): ReadonlyArray<string> =>
  [reference, own].filter((note): note is string => note !== null && note.trim() !== "")

export const notSubjectToVat = (lines: ReadonlyArray<DraftLine>): boolean =>
  lines.some((line) => line.vatCategoryCode === "O")
