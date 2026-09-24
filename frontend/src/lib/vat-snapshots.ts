import type { Issuer, VatBreakdown, VatCatalogue } from "./draft-models.ts"
import { issuerVatRegistrationOn, sameVatRate, vatRatesForIssuer } from "./vat-defaults.ts"

interface DraftTaxLine {
  readonly vatRateCode: string
  readonly vatRate: string
}
interface SavedDraftTaxLine extends DraftTaxLine {
  readonly id: string
}

export const hasStaleDraftTax = (
  issueDate: string,
  lines: ReadonlyArray<DraftTaxLine>,
  catalogue: VatCatalogue,
  issuer: Issuer,
): boolean => {
  const rates = vatRatesForIssuer(catalogue, issuer, issueDate)
  return lines.some((line) => !rates.some(({ code, rate }) =>
    code === line.vatRateCode && sameVatRate(rate, line.vatRate)))
}

export const staleDraftLineIds = (
  issueDate: string,
  lines: ReadonlyArray<SavedDraftTaxLine>,
  catalogue: VatCatalogue,
  issuer: Issuer,
): ReadonlyArray<string> => {
  const rates = vatRatesForIssuer(catalogue, issuer, issueDate)
  return lines
    .filter((line) => !rates.some(({ code, rate }) =>
      code === line.vatRateCode && sameVatRate(rate, line.vatRate)))
    .map(({ id }) => id)
}

export const issuerForIssueDate = (
  issuer: Issuer,
  date: string,
): Issuer & { readonly vatRegistered: boolean } => ({
  ...issuer,
  vatRegistered: issuerVatRegistrationOn(issuer, date) === true,
})

export const vatTreatmentLabel = (treatment: {
  readonly vatCategoryCode: VatBreakdown["vatCategoryCode"]
  readonly rate?: string
  readonly vatRate?: string
}): string => treatment.vatCategoryCode === "O"
  ? "Scutit TVA — art. 310"
  : `TVA ${treatment.rate ?? treatment.vatRate ?? ""}%`
