import { bankNameValue, ibanValue, socialCapitalValue, tradeRegistryValue } from "./issuer-legal.ts"
import { brandTextIssue, brandTextValue, type BrandingImageDraft } from "./issuer-branding.ts"
import { issuerSectorRequired, vatSelectionOf, type IssuerSettingsForm } from "./issuer-form.ts"
import { isRomanianCountyCode } from "./romanian-counties.ts"
import { romanianCuiPattern } from "./vat-defaults.ts"
import { vatChangeFromSelection } from "./issuer-settings-state.ts"
import type { IssuerInput } from "./settings-client.ts"

/**
 * What a filled settings form becomes, or the single field that refuses it.
 *
 * Like the registry editors, the refusal is a value rather than an exception or
 * a `reportValidity` call: the screen is left with one job — focus the field
 * this names — and every rule is tested without a DOM. The order is the reading
 * order of the form and is asserted, so the user is sent to the first field that
 * is wrong, not to the last rule that happened to run.
 *
 * What cannot be sent is history: `vatConfigurations` and `currentVat` are
 * answers, and `vatChange` is the only way to move the regime — which is why
 * only the checkbox and its date are read from the form here.
 */
export type IssuerField =
  | "name" | "fiscalIdentifier" | "legalForm" | "tradeRegistryNumber" | "socialCapital" | "iban"
  | "bankName" | "city" | "street" | "county" | "sector" | "brandText"
  /** Never answered here: the logo is refused while it is read, not when the form is validated. */
  | "brandImage"
  | "defaultPaymentTermDays" | "vatEffectiveFrom"
  /** Never answered here either: the checkbox is refused only when the stored regime is unreadable. */
  | "vatRegistered"

export type IssuerValidation =
  | { readonly kind: "ready"; readonly payload: IssuerInput }
  | { readonly kind: "issue"; readonly field: IssuerField; readonly message: string }

const issue = (field: IssuerField, message: string): IssuerValidation => ({ kind: "issue", field, message })

const CUI = new RegExp(`^${romanianCuiPattern}$`, "u")
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u

/** The CUI field admits the two characters of a typed `RO` prefix, which is dropped on change. */
export const FISCAL_IDENTIFIER_MAX_LENGTH = 12

export const issuerPayload = (
  form: IssuerSettingsForm,
  image: BrandingImageDraft | null,
): IssuerValidation => {
  const name = form.name.trim()
  if (name === "") return issue("name", "Denumirea legală este obligatorie.")
  const fiscalIdentifier = form.fiscalIdentifier.trim()
  if (!CUI.test(fiscalIdentifier)) {
    return issue("fiscalIdentifier", "CUI-ul este numeric, fără prefixul RO, și nu începe cu zero.")
  }
  const legalForm = form.legalForm
  if (legalForm === "") return issue("legalForm", "Selectează forma juridică.")
  const tradeRegistryNumber = tradeRegistryValue(form.tradeRegistryNumber)
  if (tradeRegistryNumber.kind === "issue") return issue("tradeRegistryNumber", tradeRegistryNumber.message)
  const socialCapital = socialCapitalValue(form.socialCapital)
  if (socialCapital.kind === "issue") return issue("socialCapital", socialCapital.message)
  const iban = ibanValue(form.iban)
  if (iban.kind === "issue") return issue("iban", iban.message)
  const bankName = bankNameValue(form.bankName)
  if (bankName.kind === "issue") return issue("bankName", bankName.message)
  const city = form.city.trim()
  if (city === "") return issue("city", "Localitatea este obligatorie.")
  const street = form.street.trim()
  if (street === "") return issue("street", "Strada și numărul sunt obligatorii.")
  if (!isRomanianCountyCode(form.county)) return issue("county", "Alege județul.")
  const sector = Number(form.sector)
  if (issuerSectorRequired(form) && !(Number.isInteger(sector) && sector >= 1 && sector <= 6)) {
    return issue("sector", "Adresele din București au un sector, de la 1 la 6.")
  }
  const brandText = brandTextIssue(form.brandText)
  if (brandText !== undefined) return issue("brandText", brandText)
  const term = Number(form.defaultPaymentTermDays)
  if (!(Number.isInteger(term) && term >= 0 && term <= 3650)) {
    return issue("defaultPaymentTermDays", "Termenul de plată este un număr întreg de zile, între 0 și 3650.")
  }
  if (!ISO_DATE.test(form.vatEffectiveFrom)) {
    return issue("vatEffectiveFrom", "Alege data de la care se aplică regimul TVA.")
  }
  const text = brandTextValue(form.brandText)
  const postalCode = form.postalCode.trim()
  return {
    kind: "ready",
    payload: {
      name,
      fiscalIdentifier,
      address: {
        countryCode: "RO",
        city,
        street,
        county: form.county,
        ...(issuerSectorRequired(form) ? { sector } : {}),
        ...(postalCode === "" ? {} : { postalCode }),
      },
      legalForm,
      tradeRegistryNumber: tradeRegistryNumber.value,
      iban: iban.value,
      bankName: bankName.value,
      socialCapital: socialCapital.value,
      defaultCurrency: "RON",
      defaultPaymentTermDays: term,
      vatChange: vatChangeFromSelection(vatSelectionOf(form)),
      // "No branding at all" is `null`: an object carrying neither text nor
      // image is refused by the backend, and an image sent without its text
      // would silently drop a brand line the form still shows.
      branding: text === null && image === null
        ? null
        : { text, image: image === null ? null : { dataBase64: image.dataBase64 } },
    },
  }
}
