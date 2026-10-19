import { isValidRomanianCui } from "../../parties/index.ts"
import type { AnafCompany, OpenapiCompany, OpenapiSuggestion } from "../contracts/providers.ts"
import { cityOf, compact, countyFromCarCode, countyFromName, isBucharest, postalCode, present, sectorFromLocality,
  type ProposedAddress } from "./address.ts"
import { normalizeCui } from "./query.ts"

/**
 * What a provider says about a company, offered to the user and never written
 * on its own. `inactive` comes from ANAF only; openapi.ro does not state it.
 */
export interface CompanyProposal {
  readonly name: string
  readonly cui: string
  readonly vatRegistered: boolean
  readonly tradeRegisterNumber?: string
  readonly inactive?: boolean
  readonly deregistered: boolean
  readonly address: ProposedAddress
}

export interface CompanySuggestion {
  readonly cui: string
  readonly name: string
  readonly county?: string
}

const streetAndNumber = (street: string | undefined, number: string | undefined): string | undefined =>
  street === undefined ? undefined : number === undefined ? street : `${street} nr. ${number}`

const anafAddress = (address: AnafCompany["adresa_sediu_social"]): ProposedAddress => {
  const county = countyFromCarCode(address?.scod_JudetAuto)
  const locality = present(address?.sdenumire_Localitate)
  return compact<ProposedAddress>({
    county,
    sector: isBucharest(county) ? sectorFromLocality(locality) : undefined,
    city: cityOf(county, locality),
    street: streetAndNumber(present(address?.sdenumire_Strada), present(address?.snumar_Strada)),
    postalCode: postalCode(address?.scod_Postal, county),
  })
}

/** ANAF v9 states the address field by field, so it maps directly. */
export const proposalFromAnaf = (company: AnafCompany): CompanyProposal => {
  const general = company.date_generale
  return compact<CompanyProposal>({
    name: general.denumire.trim(),
    cui: String(general.cui),
    vatRegistered: company.inregistrare_scop_Tva.scpTVA,
    tradeRegisterNumber: present(general.nrRegCom),
    inactive: company.stare_inactiv?.statusInactivi === true,
    deregistered: present(company.stare_inactiv?.dataRadiere) !== undefined
      || /^RADIERE\b/iu.test(present(general.stare_inregistrare) ?? ""),
    address: anafAddress(company.adresa_sediu_social),
  })
}

/** openapi.ro gives one address line: only the county and the postal code are taken from it, the line itself is shown. */
export const proposalFromOpenapi = (company: OpenapiCompany): CompanyProposal => {
  const county = countyFromName(company.judet)
  return compact<CompanyProposal>({
    name: company.denumire.trim(),
    cui: normalizeCui(company.cif),
    vatRegistered: present(company.tva) !== undefined,
    tradeRegisterNumber: present(company.numar_reg_com),
    deregistered: company.radiata === true,
    address: compact<ProposedAddress>({ county, postalCode: postalCode(company.cod_postal, county), original: present(company.adresa) }),
  })
}

const suggestionFromOpenapi = (suggestion: OpenapiSuggestion): CompanySuggestion => compact<CompanySuggestion>({
  cui: normalizeCui(suggestion.cif),
  name: suggestion.denumire.trim(),
  county: countyFromName(suggestion.judet),
})

/** A suggestion is picked to look its CUI up, so one whose CUI could not be looked up is not offered. */
export const suggestionsFromOpenapi = (suggestions: ReadonlyArray<OpenapiSuggestion>): ReadonlyArray<CompanySuggestion> =>
  suggestions.map(suggestionFromOpenapi).filter((suggestion) => isValidRomanianCui(suggestion.cui) && suggestion.name !== "")
