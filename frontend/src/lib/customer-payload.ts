import { customerSectorRequired, normalizeCustomerIdentifier, type CustomerForm } from "./customer-form.ts"
import { isRomanianCountyCode } from "./romanian-counties.ts"
import { romanianCuiPattern } from "./vat-defaults.ts"
import type { CustomerInput } from "./registry-client.ts"

/**
 * What a filled customer form becomes, or the single field that refuses it.
 *
 * The refusal is a value rather than a `reportValidity` call, so every rule is
 * tested without a DOM and the screen is left with one job: focus the field
 * this names. The order matters and is asserted — the user is sent to the first
 * field that is wrong reading down the form, not to the last rule that happens
 * to run.
 *
 * The identifier is normalized before it is validated *and* before it is sent,
 * so a `RO12345674` pasted into the field is stored as the server stores it,
 * without the prefix changing anything about the VAT regime.
 */
export type CustomerField =
  | "name" | "fiscalIdentifier" | "city" | "street" | "county" | "sector" | "defaultPaymentTermDays"

export type CustomerValidation =
  | { readonly kind: "ready"; readonly payload: CustomerInput }
  | { readonly kind: "issue"; readonly field: CustomerField; readonly message: string }

const issue = (field: CustomerField, message: string): CustomerValidation => ({ kind: "issue", field, message })

/** A CNP is exactly this many digits; a CUI has at most ten (`romanianCuiPattern`). */
const CNP_DIGITS = 13
const CUI_DIGITS = 10

/**
 * The native `maxLength` of the identifier field, derived from the same rule
 * that refuses it, so the two cannot drift apart.
 *
 * The company field admits two characters more than the ten digits of a CUI:
 * a pasted `RO12345678` is normalized to its digits on the very next change,
 * and truncating the prefix away first would corrupt the number instead of
 * cleaning it.
 */
export const identifierMaxLength = (partyType: CustomerForm["partyType"]): number =>
  partyType === "company" ? CUI_DIGITS + "RO".length : CNP_DIGITS

const CUI = new RegExp(`^${romanianCuiPattern}$`, "u")

const identifierIssue = (form: CustomerForm, identifier: string): CustomerValidation | undefined => {
  if (form.partyType === "individual") {
    return identifier === "" || /^\d{13}$/u.test(identifier)
      ? undefined
      : issue("fiscalIdentifier", "CNP-ul are exact 13 cifre sau câmpul rămâne gol.")
  }
  if (identifier === "") return issue("fiscalIdentifier", "CUI / CIF este obligatoriu pentru persoanele juridice.")
  return CUI.test(identifier)
    ? undefined
    : issue("fiscalIdentifier", "CUI-ul este numeric, fără prefixul RO, și nu începe cu zero.")
}

export const customerPayload = (form: CustomerForm): CustomerValidation => {
  const name = form.name.trim()
  if (name === "") return issue("name", "Denumirea clientului este obligatorie.")
  const fiscalIdentifier = normalizeCustomerIdentifier(form.partyType, form.fiscalIdentifier.trim())
  const identifier = identifierIssue(form, fiscalIdentifier)
  if (identifier !== undefined) return identifier
  const city = form.city.trim()
  if (city === "") return issue("city", "Localitatea este obligatorie.")
  const street = form.street.trim()
  if (street === "") return issue("street", "Strada și numărul sunt obligatorii.")
  if (!isRomanianCountyCode(form.county)) return issue("county", "Alege județul.")
  const sector = Number(form.sector)
  if (customerSectorRequired(form) && !(Number.isInteger(sector) && sector >= 1 && sector <= 6)) {
    return issue("sector", "Adresele din București au un sector, de la 1 la 6.")
  }
  const term = Number(form.defaultPaymentTermDays)
  if (form.defaultPaymentTermDays !== ""
    && !(Number.isInteger(term) && term >= 0 && term <= 3650)) {
    return issue("defaultPaymentTermDays", "Termenul de plată este un număr întreg de zile, între 0 și 3650.")
  }
  const postalCode = form.postalCode.trim()
  return {
    kind: "ready",
    payload: {
      partyType: form.partyType,
      name,
      fiscalIdentifier,
      vatRegistered: form.partyType === "company" && form.vatRegistered,
      address: {
        countryCode: "RO",
        city,
        street,
        county: form.county,
        ...(customerSectorRequired(form) ? { sector } : {}),
        ...(postalCode === "" ? {} : { postalCode }),
      },
      ...(form.defaultPaymentTermDays === "" ? {} : { defaultPaymentTermDays: term }),
    },
  }
}
