import { formField } from "./form.ts"
import type { IssuerInput } from "./invoicing-client.ts"
import { normalizeBrandText, type BrandingDraft } from "./issuer-branding.ts"
import { normalizeIssuerLegalDetails, type IssuerLegalDetails } from "./issuer-details.ts"
import { vatChangeFromSelection } from "./issuer-settings-state.ts"
import { normalizeRomanianCui } from "./vat-defaults.ts"

export const issuerBrandTextFromForm = (branding: BrandingDraft): string | null =>
  normalizeBrandText(branding.text)

export const issuerLegalDetailsFromForm = (form: HTMLFormElement): IssuerLegalDetails =>
  normalizeIssuerLegalDetails({
    legalForm: formField(form, "legalForm"),
    tradeRegistryNumber: formField(form, "tradeRegistryNumber"),
    iban: formField(form, "iban"),
    bankName: formField(form, "bankName"),
    socialCapital: formField(form, "socialCapital"),
  })

export const issuerInputFromForm = (
  form: HTMLFormElement,
  branding: BrandingDraft,
  brandText: string | null,
  legalDetails: IssuerLegalDetails,
  vatRegistered: boolean,
): IssuerInput => {
  const county = formField(form, "county")
  const sector = formField(form, "sector")
  const postalCode = formField(form, "postalCode")
  return {
    name: formField(form, "name"),
    fiscalIdentifier: normalizeRomanianCui(formField(form, "fiscalIdentifier")),
    address: {
      countryCode: "RO",
      city: formField(form, "city"),
      street: formField(form, "street"),
      county,
      ...(sector === "" ? {} : { sector: Number(sector) }),
      ...(postalCode === "" ? {} : { postalCode }),
    },
    ...legalDetails,
    defaultCurrency: "RON",
    defaultPaymentTermDays: Number(formField(form, "defaultPaymentTermDays")),
    vatChange: vatChangeFromSelection({
      registered: vatRegistered,
      effectiveFrom: formField(form, "taxEffectiveFrom"),
    }),
    branding: brandText === null && branding.image === null
      ? null
      : {
          text: brandText,
          image: branding.image === null ? null : { dataBase64: branding.image.dataBase64 },
        },
  }
}
