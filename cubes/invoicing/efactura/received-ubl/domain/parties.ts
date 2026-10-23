import type { Address, ReceivedParty } from "./document.ts"
import { defined, optionalText, textOf } from "./fields.ts"
import { all, one, refuseField, type UblNode } from "./xml-tree.ts"

/**
 * A supplier or buyer `cac:Party`: its name, its identifiers and its address.
 * A party may hold a `PartyTaxScheme` under `VAT` (the VAT code) and one under
 * another scheme (a CIF without VAT); each is read by its scheme, and two under
 * the same kind are refused.
 */
const address = (party: UblNode): Address | undefined => {
  const postal = one(party, "cac:PostalAddress")
  if (postal === undefined) return undefined
  const found = defined({
    street: optionalText(postal, "cbc:StreetName"),
    city: optionalText(postal, "cbc:CityName"),
    county: optionalText(postal, "cbc:CountrySubentity"),
    country: optionalText(postal, "cac:Country/cbc:IdentificationCode"),
  })
  return Object.keys(found).length === 0 ? undefined : found
}

const taxIdentifier = (schemes: ReadonlyArray<UblNode>, vat: boolean): string | undefined => {
  const matching = schemes.filter((scheme) => (optionalText(scheme, "cac:TaxScheme/cbc:ID") === "VAT") === vat)
  if (matching.length > 1) refuseField("duplicate", "cac:PartyTaxScheme")
  return matching[0] === undefined ? undefined : textOf(one(matching[0], "cbc:CompanyID"))
}

export const readParty = (party: UblNode): ReceivedParty => {
  const schemes = all(party, "cac:PartyTaxScheme")
  return defined({
    name: optionalText(party, "cac:PartyLegalEntity/cbc:RegistrationName") ?? optionalText(party, "cac:PartyName/cbc:Name"),
    vatId: taxIdentifier(schemes, true),
    taxRegistrationId: taxIdentifier(schemes, false),
    registrationId: optionalText(party, "cac:PartyLegalEntity/cbc:CompanyID"),
    address: address(party),
  })
}
