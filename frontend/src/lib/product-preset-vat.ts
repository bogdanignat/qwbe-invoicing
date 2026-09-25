import { activeOn } from "./vat-defaults.ts"
import type { VatCatalogue, VatRate } from "./draft-models.ts"

/**
 * Which VAT rate a product may prefer, and how that preference is shown.
 *
 * A product prefers only a *taxable* rate in force on the organization's date:
 * article 310 is a status of the issuer, never of a product, and the server
 * applies the same rule on every save. The frontend therefore never offers
 * `RO_NON_VAT` here — the exemption is resolved per document, on the document's
 * own date, by `presetVatCode` in `vat-defaults.ts`.
 */
export const preferableVatRates = (catalogue: VatCatalogue, date: string): ReadonlyArray<VatRate> =>
  catalogue.rates.filter((rate) => rate.kind !== "non_vat" && activeOn(rate, date))

export interface PresetVatOption {
  readonly value: string
  readonly label: string
}

const expiredLabel = (code: string): string => `${code} (expirată)`

/**
 * A code the law has since retired — the saved preference, or the choice on
 * screen once the day moved past its end while the page stayed open — keeps an
 * option of its own, so the editor never swaps it silently. Saving stays
 * blocked until an active rate or the issuer's default is chosen.
 */
export const presetVatOptions = (
  rates: ReadonlyArray<VatRate>, retained: ReadonlyArray<string | undefined>,
): ReadonlyArray<PresetVatOption> => [
  { value: "", label: "Implicită emitentului" },
  ...[...new Set(retained)]
    .filter((code): code is string => code !== undefined && code !== "" && !rates.some((rate) => rate.code === code))
    .map((code) => ({ value: code, label: expiredLabel(code) })),
  ...rates.map(({ code, label }) => ({ value: code, label })),
]

export const presetVatIssue = (selected: string, rates: ReadonlyArray<VatRate>): string | null =>
  selected === "" || rates.some(({ code }) => code === selected)
    ? null
    : `Cota ${selected} nu mai este în vigoare. Alege o cotă activă sau „Implicită emitentului” ca să poți salva.`

export const presetVatLabel = (preferred: string | undefined, rates: ReadonlyArray<VatRate>): string =>
  preferred === undefined
    ? "Implicită emitentului"
    : rates.find(({ code }) => code === preferred)?.label ?? expiredLabel(preferred)
