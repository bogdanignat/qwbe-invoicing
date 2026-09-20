import type { VatTreatment } from "../../domain/invoice.ts"
import { article310VatExemptionReason } from "../../domain/validation.ts"

export interface VatRate extends VatTreatment {
  readonly code: string
  readonly rate: string
  readonly kind: "standard" | "reduced" | "non_vat"
  readonly label: string
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export const activeOn = (value: { readonly effectiveFrom: string; readonly effectiveTo?: string }, date: string): boolean =>
  value.effectiveFrom <= date && (value.effectiveTo === undefined || date <= value.effectiveTo)
const taxable = (code: string, rate: string, kind: "standard" | "reduced", label: string,
  effectiveFrom: string, effectiveTo?: string): VatRate => ({ code, rate, kind, label, effectiveFrom,
  ...(effectiveTo === undefined ? {} : { effectiveTo }), vatCategoryCode: "S", vatExemptionReason: null })
// Cod fiscal art. 291 and Legea 141/2025; bounded to the preceding/current rate sets.
export const romanianVatRates: ReadonlyArray<VatRate> = [
  taxable("RO_STANDARD", "19.00", "standard", "TVA standard 19%", "2025-01-01", "2025-07-31"),
  taxable("RO_REDUCED", "9.00", "reduced", "TVA redus 9%", "2025-01-01", "2025-07-31"),
  taxable("RO_REDUCED_5", "5.00", "reduced", "TVA redus 5%", "2025-01-01", "2025-07-31"),
  taxable("RO_STANDARD", "21.00", "standard", "TVA standard 21%", "2025-08-01"),
  taxable("RO_REDUCED", "11.00", "reduced", "TVA redus 11%", "2025-08-01"),
  // Article 310: the rate stays "0.00" internally because the model requires a
  // rate and the tax due really is nothing; the e-Factura mapper turns that into
  // the *absent* BT-152/BT-119 the `O` category demands. The stored reason is
  // the legal text, which the mapper moves from BT-120 to BT-22.
  { code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "O", vatExemptionReason: article310VatExemptionReason,
    kind: "non_vat", label: "Scutit TVA — art. 310", effectiveFrom: "2025-01-01" },
]

export const vatRatesOn = (date: string): ReadonlyArray<VatRate> => romanianVatRates.filter((rate) => activeOn(rate, date))

// Whether a code names a taxable rate in force on the date. Article 310 is a status of the
// issuer, not a rate a product can carry, so `RO_NON_VAT` is never taxable here.
export const isTaxableVatRateOn = (code: string, date: string): boolean =>
  vatRatesOn(date).some((rate) => rate.code === code && rate.kind !== "non_vat")
