import type { Address, BuyerSnapshot, Issuer, IssuerCompanySnapshot, PartyType } from "./models.ts"
import { romanianCountyName } from "./romanian-counties.ts"

interface FiscalIdentity {
  readonly identifierLabel: "CNP" | "CUI / CIF"
  readonly fiscalIdentifier: string
  readonly vatIdentifier: string | null
}

export const fiscalIdentity = (party: {
  readonly partyType?: PartyType
  readonly fiscalIdentifier: string
  readonly vatRegistered: boolean
}): FiscalIdentity => ({
  identifierLabel: party.partyType === "individual" ? "CNP" : "CUI / CIF",
  fiscalIdentifier: party.fiscalIdentifier,
  vatIdentifier: party.vatRegistered && party.fiscalIdentifier !== "" ? `RO${party.fiscalIdentifier}` : null,
})

export const buyerFiscalIdentity = (buyer: BuyerSnapshot): FiscalIdentity => fiscalIdentity(buyer)
export const issuerFiscalIdentity = (issuer: IssuerCompanySnapshot): FiscalIdentity => fiscalIdentity(issuer)

export type IssuerVatPresentation = { readonly fiscalIdentifier: string } & (
  Pick<IssuerCompanySnapshot, "vatRegistered"> | Pick<Issuer, "currentVat">
)
export const issuerPresentationIdentity = (issuer: IssuerVatPresentation): FiscalIdentity => fiscalIdentity({
  fiscalIdentifier: issuer.fiscalIdentifier,
  vatRegistered: "vatRegistered" in issuer ? issuer.vatRegistered : issuer.currentVat?.registered === true,
})

export const formattedRomanianAddress = (address: Address): string => [
  address.street,
  address.city,
  romanianCountyName(address.county),
  address.sector === undefined ? undefined : `Sector ${String(address.sector)}`,
  address.postalCode,
  address.countryCode,
].filter((part) => part !== undefined && part !== "").join(", ")
