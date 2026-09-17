import type { EFacturaAddress, EFacturaParty } from "./contracts/document.ts"
import type { EFacturaProfile } from "./profile.ts"
import { element, optional, text, type XmlElement } from "./xml.ts"

/**
 * Renders the seller and buyer as UBL parties.
 *
 * Element order follows the `xsd:sequence` of `cac:PartyType` and
 * `cac:AddressType` in UBL-CommonAggregateComponents-2.1: a correctly
 * populated party in the wrong order is still a schema-invalid document.
 */

/** cac:AddressType — StreetName, CityName, PostalZone, CountrySubentity, Country. */
const postalAddress = (address: EFacturaAddress): XmlElement =>
  element("cac:PostalAddress", [
    text("cbc:StreetName", address.streetName),
    text("cbc:CityName", address.cityName),
    ...optional("cbc:PostalZone", address.postalZone),
    // BT-39/BT-54 is mandatory for a Romanian address and unasked for anywhere
    // else, so a blank one is omitted rather than sent as an empty element.
    ...optional("cbc:CountrySubentity", address.countrySubentity),
    element("cac:Country", [text("cbc:IdentificationCode", address.countryCode)]),
  ])

/**
 * BT-31 and BT-32 share one UBL element and are told apart by their tax
 * scheme: the VAT identifier sits under scheme `VAT`, while the plain tax
 * registration identifier of a non-registered issuer sits under the scheme
 * named in the profile. Emitting the latter under `VAT` would claim a VAT
 * registration the seller does not hold.
 */
const taxSchemes = (party: EFacturaParty, profile: EFacturaProfile): ReadonlyArray<XmlElement> => {
  const schemes: Array<XmlElement> = []
  if (party.vatIdentifier !== null) {
    schemes.push(element("cac:PartyTaxScheme", [
      text("cbc:CompanyID", party.vatIdentifier),
      element("cac:TaxScheme", [text("cbc:ID", "VAT")]),
    ]))
  }
  if (party.taxRegistrationIdentifier !== null) {
    schemes.push(element("cac:PartyTaxScheme", [
      text("cbc:CompanyID", party.taxRegistrationIdentifier),
      element("cac:TaxScheme", [text("cbc:ID", profile.nonVatTaxSchemeId)]),
    ]))
  }
  return schemes
}

export const party = (wrapper: string, source: EFacturaParty, profile: EFacturaProfile): XmlElement =>
  element(wrapper, [
    element("cac:Party", [
      element("cac:PartyName", [text("cbc:Name", source.registrationName)]),
      postalAddress(source.address),
      ...taxSchemes(source, profile),
      element("cac:PartyLegalEntity", [
        text("cbc:RegistrationName", source.registrationName),
        // BT-30 is the legal registration identifier — the trade registry
        // number — not the tax identifier, which already appears above.
        ...optional("cbc:CompanyID", source.legalRegistrationIdentifier),
      ]),
    ]),
  ])
