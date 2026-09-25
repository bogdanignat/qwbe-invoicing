import { activeOn, configurationRegistration, sameVatRate } from "./vat-defaults.ts"
import type { NonVatBasis, VatCatalogue, VatConfiguration } from "./draft-models.ts"

/**
 * The regime the issuer is *not* in today, and the regimes it has been in.
 *
 * `currentVat` answers only the period that covers today. An organization can
 * legitimately have none: a change scheduled for next month, or a regime that
 * ended and was never replaced. The settings form still has to open with a
 * meaningful choice, so that neighbouring period is resolved here and labelled
 * with its timing, which is what the status line under the checkbox says.
 *
 * The history is shown read-only: the configurations are grouped by the period
 * they belong to, because a VAT-registered issuer has several rates in force at
 * once and they are one regime, not three. A group whose rates do not form a
 * regime this app can name is reported as such rather than guessed at or thrown
 * over — a stored fiscal fact is not made truer by hiding the screen behind an
 * exception.
 */
interface VatPeriodTiming {
  readonly effectiveFrom: string
  readonly timing: "scheduled" | "expired"
}

export type FallbackVatRegistration = VatPeriodTiming & (
  { readonly registered: true; readonly nonVatBasis?: never }
  | { readonly registered: false; readonly nonVatBasis: NonVatBasis }
)

export const fallbackVatRegistration = (
  configurations: ReadonlyArray<VatConfiguration>,
  date: string,
): FallbackVatRegistration | undefined => {
  const scheduled = [...configurations]
    .filter(({ effectiveFrom }) => effectiveFrom > date)
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))[0]
  const expired = [...configurations]
    .filter((configuration): configuration is VatConfiguration & { readonly effectiveTo: string } =>
      configuration.effectiveTo !== undefined && configuration.effectiveTo < date)
    .sort((left, right) => right.effectiveTo.localeCompare(left.effectiveTo))[0]
  const selected = scheduled ?? expired
  if (selected === undefined) return undefined
  const registered = configurationRegistration(configurations.filter((configuration) =>
    activeOn(configuration, selected.effectiveFrom)))
  if (registered === undefined) return undefined
  const timing = { effectiveFrom: selected.effectiveFrom, timing: scheduled === undefined ? "expired" as const : "scheduled" as const }
  return registered ? { registered: true, ...timing } : { registered: false, nonVatBasis: "article_310", ...timing }
}

export interface VatHistoryItem {
  readonly effectiveFrom: string
  readonly effectiveTo?: string
  /** The labels the catalogue gives those rates, or the bare percentages it does not know. */
  readonly rates: string
  /** `undefined` when the stored rates do not form a regime this app can name. */
  readonly registered: boolean | undefined
}

export const vatRegistrationHistory = (
  configurations: ReadonlyArray<VatConfiguration>,
  catalogue: VatCatalogue,
): ReadonlyArray<VatHistoryItem> => {
  const periods = new Map<string, ReadonlyArray<VatConfiguration>>()
  for (const configuration of configurations) {
    const key = `${configuration.effectiveFrom}:${configuration.effectiveTo ?? ""}`
    periods.set(key, [...(periods.get(key) ?? []), configuration])
  }
  return [...periods.values()]
    .filter((group): group is readonly [VatConfiguration, ...Array<VatConfiguration>] => group.length > 0)
    .map((group) => ({
      effectiveFrom: group[0].effectiveFrom,
      ...(group[0].effectiveTo === undefined ? {} : { effectiveTo: group[0].effectiveTo }),
      rates: group.map((configuration) => catalogue.rates.find((rate) =>
        rate.code === configuration.code && sameVatRate(rate.rate, configuration.rate))?.label
        ?? `${configuration.rate}%`).join(", "),
      registered: configurationRegistration(group),
    }))
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))
}
