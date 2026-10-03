import { countyRequiresSector } from "./romanian-counties.ts"
import { normalizeRomanianCui } from "./vat-defaults.ts"
import type { Customer } from "./draft-models.ts"
import type { PartyType } from "./document-authoring-form-model.ts"

/**
 * The customer editor as data: a flat, controlled form and the two transitions
 * that are not a plain field write.
 *
 * Switching the party type re-normalizes the identifier, because the two kinds
 * are not the same string — a CUI keeps its digits after the `RO` prefix is
 * dropped, a CNP is digits only — and choosing a county drops a sector the new
 * county has no room for: only Bucharest has sectors, and a stale `3` would be
 * sent with an Iași address.
 *
 * `normalizeRomanianCui` and `countyRequiresSector` are the modules the
 * authoring buyer already validates through; the registry screen reuses them
 * rather than porting a second copy from the legacy app.
 */
export interface CustomerForm {
  readonly partyType: PartyType
  readonly name: string
  readonly fiscalIdentifier: string
  readonly vatRegistered: boolean
  readonly city: string
  readonly street: string
  readonly county: string
  /** Held as the string a `<select>` carries; `""` is "no sector". */
  readonly sector: string
  readonly postalCode: string
  /** Empty means "use the issuer's default term", not zero days. */
  readonly defaultPaymentTermDays: string
}

export const newCustomerForm = (): CustomerForm => ({
  partyType: "company",
  name: "",
  fiscalIdentifier: "",
  vatRegistered: false,
  city: "",
  street: "",
  county: "",
  sector: "",
  postalCode: "",
  defaultPaymentTermDays: "",
})

export const customerFormOf = (customer: Customer): CustomerForm => ({
  partyType: customer.partyType,
  name: customer.name,
  fiscalIdentifier: customer.fiscalIdentifier,
  vatRegistered: customer.vatRegistered,
  city: customer.address.city,
  street: customer.address.street,
  county: customer.address.county,
  sector: customer.address.sector === undefined ? "" : String(customer.address.sector),
  postalCode: customer.address.postalCode ?? "",
  defaultPaymentTermDays: customer.defaultPaymentTermDays === undefined
    ? ""
    : String(customer.defaultPaymentTermDays),
})

/**
 * A CUI keeps its digits once the typed `RO` prefix is dropped; a CNP is digits
 * only. The second trim catches the space in a pasted `RO 12345674`, which the
 * shared normalizer leaves behind after dropping the prefix.
 */
export const normalizeCustomerIdentifier = (partyType: PartyType, value: string): string =>
  partyType === "company" ? normalizeRomanianCui(value).trim() : value.replace(/\D/gu, "")

export const switchCustomerPartyType = (form: CustomerForm, partyType: PartyType): CustomerForm => ({
  ...form,
  partyType,
  fiscalIdentifier: normalizeCustomerIdentifier(partyType, form.fiscalIdentifier),
  // Only a company is registered for VAT; the flag would otherwise survive a
  // switch to an individual and be sent as `true`.
  vatRegistered: partyType === "company" && form.vatRegistered,
})

export const chooseCustomerCounty = (form: CustomerForm, county: string): CustomerForm => ({
  ...form,
  county,
  sector: countyRequiresSector(county) ? form.sector : "",
})

export const customerSectorRequired = (form: CustomerForm): boolean => countyRequiresSector(form.county)
