import type { VatConfiguration } from "../../domain/invoice.ts"
import type { VatChange } from "../../domain/inputs.ts"

// The VAT regimes an issuer can be in. This is the only place the rates live: the UI and any
// external caller read them from `GET /vat-regimes` instead of carrying their own copy.
export interface VatRegime {
  readonly code: string
  readonly rate: string
  readonly registered: boolean
  readonly label: string
}

// Romanian rates in force since 1 August 2025 (Legea 141/2025): 21% standard, 11% reduced.
export const romanianVatRegimes: ReadonlyArray<VatRegime> = [
  { code: "RO_STANDARD", rate: "21.00", registered: true, label: "TVA standard 21%" },
  { code: "RO_REDUCED", rate: "11.00", registered: true, label: "TVA redus 11%" },
  { code: "RO_NON_VAT", rate: "0.00", registered: false, label: "Neplătitor de TVA" },
]

// A Romanian fiscal identifier carries the VAT registration in its prefix: `RO` + CUI means
// registered, a bare CUI means not registered. Anything else gives no default.
export const inferVatRegime = (countryCode: string, fiscalIdentifier: string): VatRegime | undefined => {
  if (countryCode.trim().toUpperCase() !== "RO") return undefined
  const identifier = fiscalIdentifier.trim().toUpperCase()
  if (/^RO\d+$/.test(identifier)) return romanianVatRegimes.find((regime) => regime.code === "RO_STANDARD")
  if (/^\d+$/.test(identifier)) return romanianVatRegimes.find((regime) => regime.code === "RO_NON_VAT")
  return undefined
}

const sameRate = (left: string, right: string): boolean => Number(left) === Number(right)
const byEffectiveFrom = (left: VatConfiguration, right: VatConfiguration): number => left.effectiveFrom.localeCompare(right.effectiveFrom)

// The configuration that applies on `date`; when none does, the nearest scheduled one, so a
// freshly scheduled regime is what the issuer sees as current.
export const effectiveVatConfiguration = (
  configurations: ReadonlyArray<VatConfiguration>,
  date: string,
): VatConfiguration | undefined => {
  const current = configurations.find((configuration) =>
    configuration.effectiveFrom <= date && (configuration.effectiveTo === undefined || date <= configuration.effectiveTo))
  if (current !== undefined) return current
  const ordered = [...configurations].sort(byEffectiveFrom)
  return ordered.find((configuration) => configuration.effectiveFrom > date) ?? ordered.at(-1)
}

const previousDay = (date: string): string => {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

// Schedules a regime from a date: history before it is kept and the open period closed the day
// before; anything scheduled on or after it is replaced. Scheduling what is already in place is a no-op.
export const scheduleVatRegime = (
  configurations: ReadonlyArray<VatConfiguration>,
  change: VatChange,
): ReadonlyArray<VatConfiguration> => {
  if (configurations.some((configuration) => configuration.effectiveFrom === change.effectiveFrom
    && configuration.code === change.code && sameRate(configuration.rate, change.rate))) return configurations
  const kept = configurations.filter((configuration) => configuration.effectiveFrom < change.effectiveFrom).sort(byEffectiveFrom)
  const previous = kept.at(-1)
  const closed = previous === undefined ? kept : kept.map((configuration) => configuration === previous
    ? { ...configuration, effectiveTo: previousDay(change.effectiveFrom) }
    : configuration)
  return [...closed, { code: change.code, rate: change.rate, effectiveFrom: change.effectiveFrom }]
}
