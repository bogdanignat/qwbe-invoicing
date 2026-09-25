import { countyRequiresSector } from "./romanian-counties.ts"
import { savedBrandText } from "./issuer-branding.ts"
import { normalizeRomanianCui } from "./vat-defaults.ts"
import type { Issuer } from "./draft-models.ts"
import type { VatSettingsSelection } from "./issuer-settings-state.ts"

/**
 * The issuer profile as the settings form holds it: flat, controlled, all
 * strings.
 *
 * The legacy screen was an uncontrolled `<form>` read through `formField` at
 * submit and remounted by a changing `key` after every save. That made the
 * saved answer and the typed form two sources of truth for the same fields,
 * with the DOM as the arbiter. Holding the form as data instead means the reset
 * after a save is `issuerFormOf(saved)` — and the revision guard decides whether
 * it happens at all.
 *
 * The brand *text* belongs here, with the other typed fields; the image does
 * not, because it is read asynchronously and has a validation state of its own.
 *
 * `null` is the issuer that has not been configured yet: the API answers `404`
 * until the first save, and the form opens on the defaults a new profile gets.
 */
export const DEFAULT_PAYMENT_TERM_DAYS = 15

export interface IssuerSettingsForm {
  readonly name: string
  readonly fiscalIdentifier: string
  /** `""` until a form is chosen: the app never assumes SRL for a new profile. */
  readonly legalForm: "" | "srl" | "pfa"
  readonly tradeRegistryNumber: string
  readonly city: string
  readonly street: string
  readonly county: string
  /** Held as the string a `<select>` carries; `""` is "no sector". */
  readonly sector: string
  readonly postalCode: string
  readonly socialCapital: string
  readonly iban: string
  readonly bankName: string
  readonly defaultPaymentTermDays: string
  readonly vatRegistered: boolean
  readonly vatEffectiveFrom: string
  readonly brandText: string
}

export const issuerFormOf = (issuer: Issuer | null, vat: VatSettingsSelection): IssuerSettingsForm => ({
  name: issuer?.name ?? "",
  fiscalIdentifier: issuer?.fiscalIdentifier ?? "",
  legalForm: issuer?.legalForm ?? "",
  tradeRegistryNumber: issuer?.tradeRegistryNumber ?? "",
  city: issuer?.address.city ?? "",
  street: issuer?.address.street ?? "",
  county: issuer?.address.county ?? "",
  sector: issuer?.address.sector === undefined ? "" : String(issuer.address.sector),
  postalCode: issuer?.address.postalCode ?? "",
  socialCapital: issuer?.socialCapital ?? "",
  iban: issuer?.iban ?? "",
  bankName: issuer?.bankName ?? "",
  defaultPaymentTermDays: String(issuer?.defaultPaymentTermDays ?? DEFAULT_PAYMENT_TERM_DAYS),
  vatRegistered: vat.registered,
  vatEffectiveFrom: vat.effectiveFrom,
  brandText: savedBrandText(issuer?.branding ?? null),
})

/**
 * The form an edit produces, given what the edits before it in the same React
 * batch already produced. `undefined` is "nothing typed yet", so the edit starts
 * from the saved profile.
 *
 * It exists as a function because the base must be the *queued* form, never the
 * one captured while rendering: a browser autofill fires one `onChange` per
 * field in a single batch, and an edit that reads the rendered form makes every
 * one of them start from the same saved profile — city, street and postal code
 * are written over each other and only the last one survives, with no error.
 */
export const editedIssuerForm = (
  current: IssuerSettingsForm | undefined,
  saved: IssuerSettingsForm,
  edit: (form: IssuerSettingsForm) => IssuerSettingsForm,
): IssuerSettingsForm => edit(current ?? saved)

/**
 * Choosing a county drops a sector the new county has no room for: only
 * Bucharest has sectors, and a stale `3` would be sent with an Iași address.
 */
export const chooseIssuerCounty = (form: IssuerSettingsForm, county: string): IssuerSettingsForm => ({
  ...form,
  county,
  sector: countyRequiresSector(county) ? form.sector : "",
})

export const issuerSectorRequired = (form: IssuerSettingsForm): boolean => countyRequiresSector(form.county)

/**
 * The identifier is stored numeric: a pasted `RO 12345674` keeps its digits and
 * loses the prefix, which says nothing about the VAT regime — that is the
 * checkbox, and only the checkbox.
 */
export const changeIssuerIdentifier = (form: IssuerSettingsForm, value: string): IssuerSettingsForm => ({
  ...form,
  fiscalIdentifier: normalizeRomanianCui(value).trim(),
})

/** Choosing a regime dates the change today, as the legacy screen did. */
export const changeVatRegistration = (
  form: IssuerSettingsForm, registered: boolean, today: string,
): IssuerSettingsForm => ({ ...form, vatRegistered: registered, vatEffectiveFrom: today })

/** The `<select>` carries a string; only the two forms the profile accepts survive it. */
export const legalFormValue = (value: string): IssuerSettingsForm["legalForm"] =>
  value === "srl" || value === "pfa" ? value : ""

export const vatSelectionOf = (form: IssuerSettingsForm): VatSettingsSelection => ({
  registered: form.vatRegistered,
  effectiveFrom: form.vatEffectiveFrom,
})
