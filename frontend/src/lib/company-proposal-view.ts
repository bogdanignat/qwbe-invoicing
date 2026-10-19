import type { CompanyProposal, CompanySuggestion } from "./company-lookup-model.ts"
import { romanianCountyName } from "./romanian-counties.ts"

/**
 * The words of the proposal card and of a suggestion, in Romanian.
 *
 * `vat` says what the form does with the provider's VAT status: a customer gets
 * it as a suggestion it can change, the issuer only reads it — its own VAT
 * regime is the settings' VAT section and is never changed from here.
 */
export type ProposalVatUse = "suggested" | "informative"

const withCounty = (name: string, county: string | undefined): string =>
  county === undefined ? name : `${name}, ${romanianCountyName(county)}`

export const proposalHeadline = (proposal: CompanyProposal): string =>
  `Am găsit: ${withCounty(proposal.name, proposal.address.county)}`

export const suggestionLabel = (suggestion: CompanySuggestion): string => withCounty(suggestion.name, suggestion.county)

/** What makes the company a doubtful party; empty when nothing does. */
export const proposalWarnings = (proposal: CompanyProposal): ReadonlyArray<string> => [
  ...(proposal.deregistered ? ["Atenție: firma figurează ca radiată."] : []),
  ...(proposal.inactive === true ? ["Atenție: firma este declarată inactivă fiscal."] : []),
]

export const proposalVatLine = (proposal: CompanyProposal, use: ProposalVatUse): string => {
  const status = proposal.vatRegistered ? "înregistrată în scopuri de TVA" : "neînregistrată în scopuri de TVA"
  return use === "suggested"
    ? `Furnizorul o arată ${status}; bifa se completează și o poți schimba.`
    : `Furnizorul o arată ${status}. Regimul TVA din setări nu se schimbă.`
}

/** openapi.ro's address line, for the user to copy the city and street from. */
export const proposalAddressReference = (proposal: CompanyProposal): string | undefined =>
  proposal.address.original === undefined ? undefined : `Adresa la furnizor: ${proposal.address.original}`
