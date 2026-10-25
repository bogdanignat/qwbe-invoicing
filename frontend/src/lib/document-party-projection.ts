import { orDash } from "./format.ts"
import { money } from "./money.ts"
import { addressCountyName } from "./romanian-counties.ts"
import type { Address, BuyerSnapshot, IssuerSnapshot } from "./document-snapshot.ts"

/** The two party blocks of an issued document, as the legacy document prints them. */
export interface PartyView {
  readonly heading: string
  readonly name: string
  readonly details: ReadonlyArray<string>
}

/**
 * The address as the legacy document prints it: names, not codes.
 *
 * `county` is stored as an ISO 3166-2 code (`RO-B`, `RO-BT`) because that is
 * what `validateParty` accepts, so it is resolved to its name here, and left
 * out when the city already says it (`București`, `RO-B`). The order
 * follows the legacy `formattedRomanianAddress` — street, city, county, sector,
 * postal code, country — and parts the snapshot does not carry are dropped
 * rather than printed as empty separators.
 */
const addressLine = (address: Address): string => [
  address.street,
  address.city,
  addressCountyName(address.city, address.county),
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
export const issuerView = (issuer: IssuerSnapshot): PartyView => ({
  heading: "Furnizor",
  name: issuer.name,
  details: [
    `Formă juridică ${issuer.legalForm.toUpperCase()}`,
    issuer.fiscalIdentifier === "" ? undefined : `CUI / CIF ${issuer.fiscalIdentifier}`,
    issuer.vatRegistered && issuer.fiscalIdentifier !== ""
      ? `Cod TVA RO${issuer.fiscalIdentifier}`
      : vatNote(issuer.vatRegistered),
    issuer.tradeRegistryNumber === "" ? undefined : `Nr. Reg. Com. ${issuer.tradeRegistryNumber}`,
    issuer.socialCapital === "" ? undefined : `Capital social ${money(issuer.socialCapital, "RON")}`,
    issuer.iban === "" ? undefined : `IBAN ${issuer.iban}`,
    issuer.bankName === "" ? undefined : `Bancă ${issuer.bankName}`,
    addressLine(issuer.address),
  ].filter((detail): detail is string => detail !== undefined),
})

export const customerView = (customer: BuyerSnapshot): PartyView => ({
  heading: "Cumpărător",
  name: customer.name,
  details: [
    customer.partyType === "company" ? "Persoană juridică" : "Persoană fizică",
    `${customer.partyType === "company" ? "CUI" : "CNP"} ${orDash(customer.fiscalIdentifier)}`,
    addressLine(customer.address),
    vatNote(customer.vatRegistered),
  ],
})
