import { definedFields, type CompanyProposal, type ProposedAddress } from "./company-lookup-model.ts"
import type { CustomerForm } from "./customer-form.ts"
import type { DocumentAuthoringForm } from "./document-authoring-form-model.ts"
import type { IssuerSettingsForm } from "./issuer-form.ts"
import { countyRequiresSector } from "./romanian-counties.ts"

/**
 * A proposal copied into a form, on the user's click. Each function answers the
 * patch the form's own `onChange` applies: only what the provider stated for
 * certain is written, and a field it left out keeps what the user typed — an
 * openapi.ro answer carries no city or street, so those stay for the user.
 *
 * The sector follows the county: kept only in Bucharest, taken from the
 * proposal when it names one, and dropped when the county moves to Bucharest
 * without one, so the form asks for it instead of keeping a stale guess.
 */
interface StringAddress {
  readonly county: string
  readonly sector: string
  readonly city: string
  readonly street: string
  readonly postalCode: string
}

const filledSector = (county: string, proposed: number | undefined, current: { county: string; sector: string }): string => {
  if (!countyRequiresSector(county)) return ""
  if (proposed !== undefined) return String(proposed)
  return county === current.county ? current.sector : ""
}

const stringAddressFill = (current: StringAddress, address: ProposedAddress): Partial<StringAddress> => {
  const county = address.county ?? current.county
  return definedFields<Partial<StringAddress>>({
    county,
    sector: filledSector(county, address.sector, current),
    city: address.city,
    street: address.street,
    postalCode: address.postalCode,
  })
}

/** The registry's customer: identity, the suggested VAT flag (left editable) and the address. Companies only. */
export const customerFill = (form: CustomerForm, proposal: CompanyProposal): Partial<CustomerForm> =>
  form.partyType !== "company" ? {} : {
    name: proposal.name,
    fiscalIdentifier: proposal.cui,
    vatRegistered: proposal.vatRegistered,
    ...stringAddressFill(form, proposal.address),
  }

/** The issuer: identity, trade register number and address. Its VAT regime is never touched. */
export const issuerFill = (form: IssuerSettingsForm, proposal: CompanyProposal): Partial<IssuerSettingsForm> => ({
  name: proposal.name,
  fiscalIdentifier: proposal.cui,
  ...definedFields<Partial<IssuerSettingsForm>>({ tradeRegistryNumber: proposal.tradeRegisterNumber }),
  ...stringAddressFill(form, proposal.address),
})

/** The one-time buyer of a document; its sector is a number. Companies only. */
export const oneTimeBuyerFill = (form: DocumentAuthoringForm, proposal: CompanyProposal): Partial<DocumentAuthoringForm> => {
  if (form.partyType !== "company") return {}
  const { address } = proposal
  const current = { county: form.county, sector: form.sector === undefined ? "" : String(form.sector) }
  const county = address.county ?? form.county
  const sector = filledSector(county, address.sector, current)
  return {
    name: proposal.name,
    companyTaxIdentifier: proposal.cui,
    vatRegistered: proposal.vatRegistered,
    county,
    sector: sector === "" ? undefined : Number(sector),
    ...definedFields<Partial<DocumentAuthoringForm>>({ city: address.city, street: address.street, postalCode: address.postalCode }),
  }
}
