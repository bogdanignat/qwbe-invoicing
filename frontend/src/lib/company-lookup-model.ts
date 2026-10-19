import { array, boolean, integer, object, optionalInteger, optionalText, text } from "./model-decoder.ts"
import type { LookupProvider } from "./company-lookup-settings.ts"

/**
 * What the company-lookup routes answer (`kernel/api/schema-company-lookup.ts`),
 * decoded at the boundary. A proposal is only offered: the forms copy it in on
 * the user's click and never on their own.
 */
export interface CompanyLookupAvailability {
  readonly provider: LookupProvider
  readonly nameSearch: boolean
  readonly minCuiDigits: number
  readonly minNameLetters: number
}

export interface ProposedAddress {
  /** ISO code, `RO-XX`. */
  readonly county?: string
  readonly sector?: number
  readonly city?: string
  readonly street?: string
  readonly postalCode?: string
  /** openapi.ro's single address line, shown for reference and never parsed. */
  readonly original?: string
}

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

const PROVIDERS: ReadonlyArray<LookupProvider> = ["none", "anaf", "openapi"]

/** Keeps only the fields that are set, so an absent field is absent rather than present-and-`undefined`. */
export const definedFields = <Value extends object>(value: { readonly [Key in keyof Value]?: Value[Key] | undefined }): Value =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Value

export const decodeAvailability = (input: unknown): CompanyLookupAvailability => {
  const value = object(input)
  const provider = PROVIDERS.find((known) => known === value.provider)
  if (provider === undefined) throw new Error("invalid provider")
  return {
    provider,
    nameSearch: boolean(value.nameSearch, "nameSearch"),
    minCuiDigits: integer(value.minCuiDigits, "minCuiDigits"),
    minNameLetters: integer(value.minNameLetters, "minNameLetters"),
  }
}

const decodeAddress = (input: unknown): ProposedAddress => {
  const value = object(input)
  return definedFields<ProposedAddress>({
    county: optionalText(value.county, "address.county"),
    sector: optionalInteger(value.sector, "address.sector"),
    city: optionalText(value.city, "address.city"),
    street: optionalText(value.street, "address.street"),
    postalCode: optionalText(value.postalCode, "address.postalCode"),
    original: optionalText(value.original, "address.original"),
  })
}

export const decodeProposal = (input: unknown): CompanyProposal => {
  const value = object(input)
  return definedFields<CompanyProposal>({
    name: text(value.name, "name"),
    cui: text(value.cui, "cui"),
    vatRegistered: boolean(value.vatRegistered, "vatRegistered"),
    tradeRegisterNumber: optionalText(value.tradeRegisterNumber, "tradeRegisterNumber"),
    inactive: value.inactive === undefined ? undefined : boolean(value.inactive, "inactive"),
    deregistered: boolean(value.deregistered, "deregistered"),
    address: decodeAddress(value.address),
  })
}

const decodeSuggestion = (input: unknown): CompanySuggestion => {
  const value = object(input)
  return definedFields<CompanySuggestion>({
    cui: text(value.cui, "cui"),
    name: text(value.name, "name"),
    county: optionalText(value.county, "county"),
  })
}

export const decodeSuggestions = (input: unknown): ReadonlyArray<CompanySuggestion> =>
  array(object(input).items, decodeSuggestion, "items")
