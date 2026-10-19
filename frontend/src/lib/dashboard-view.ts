import { money } from "./format.ts"
import type { CollectionsReport, RevenueReport } from "./report-models.ts"
import type { ReportRange } from "./report-period.ts"

/**
 * What the dashboard renders, projected from the two reports and nothing else:
 * no amount is recomputed here, only labelled. Statuses, balances and totals
 * are the backend's; this module decides wording and which figure goes where.
 */
export interface StatCard {
  readonly key: string
  readonly label: string
  readonly value: string
  readonly hint?: string
}

export interface ChartMonth {
  readonly month: string
  readonly label: string
  readonly invoiced: string
  /** Absent without the payments plugin, or while its report is not the same period. */
  readonly collected: string | undefined
}

const MONTHS = ["ian.", "feb.", "mar.", "apr.", "mai", "iun.", "iul.", "aug.", "sept.", "oct.", "nov.", "dec."]

/** `2026-03` → `mar.`. */
export const monthAbbreviation = (month: string): string => MONTHS[Number(month.slice(5, 7)) - 1] ?? month

/** `2026-03` → `mar. 2026`. */
export const monthLabel = (month: string): string => `${monthAbbreviation(month)} ${month.slice(0, 4)}`

/** Romanian counting: `1 factură`, `19 facturi`, `20 de facturi`, `101 facturi`. */
export const counted = (count: number, one: string, many: string): string => {
  if (count === 1) return `1 ${one}`
  const rest = count % 100
  return `${String(count)} ${count !== 0 && (rest === 0 || rest >= 20) ? "de " : ""}${many}`
}

/** A collections report counts only for the period the revenue report answered: a stale one is not drawn. */
export const samePeriod = (revenue: RevenueReport, collections: CollectionsReport | undefined): CollectionsReport | undefined =>
  collections !== undefined && collections.from === revenue.from && collections.to === revenue.to ? collections : undefined

export const periodCards = (revenue: RevenueReport, collected: StatCard | undefined): ReadonlyArray<StatCard> => {
  const { totals, currency } = revenue
  return [
    {
      key: "revenue", label: "Cifra de afaceri (fără TVA)", value: money(totals.revenueExcludingVat, currency),
      hint: `${counted(totals.invoiceCount, "factură", "facturi")}, ${counted(totals.correctionCount, "storno", "storno")}`,
    },
    { key: "invoiced", label: "Facturat (cu TVA)", value: money(totals.invoicedIncludingVat, currency), hint: "Facturi minus storno-uri" },
    ...(collected === undefined ? [] : [collected]),
  ]
}

/** The „Încasat” card: undefined without the plugin, a placeholder while its report loads or failed. */
export const collectedCard = (collections: CollectionsReport | undefined, failed: boolean): StatCard => ({
  key: "collected",
  label: "Încasat",
  value: collections === undefined ? (failed ? "Indisponibil" : "Se încarcă…") : money(collections.collected, collections.currency),
  hint: "Plăți minus stornări de plăți, după data plății",
})

export const chartMonths = (revenue: RevenueReport, collections: CollectionsReport | undefined): ReadonlyArray<ChartMonth> =>
  revenue.months.map((entry) => ({
    month: entry.month,
    label: monthLabel(entry.month),
    invoiced: entry.invoicedIncludingVat,
    collected: collections === undefined
      ? undefined
      : collections.months.find((candidate) => candidate.month === entry.month)?.collected ?? "0.00",
  }))

/** The period block's subtitle; the collections clause only when the payments plugin runs. */
export const periodCaption = (range: ReportRange, payments: boolean): string =>
  `${range.from} – ${range.to}. Facturile și storno-urile după data emiterii${payments ? ", încasările după data plății" : ""}.`

export interface PeriodView {
  readonly currency: string
  readonly cards: ReadonlyArray<StatCard>
  readonly months: ReadonlyArray<ChartMonth>
}

/** What the collections report can contribute to the period block; undefined without the payments plugin. */
export interface CollectedInput {
  readonly report: CollectionsReport | undefined
  readonly failed: boolean
}

export const periodView = (revenue: RevenueReport, collections: CollectedInput | undefined): PeriodView => {
  const collected = collections === undefined ? undefined : samePeriod(revenue, collections.report)
  return {
    currency: revenue.currency,
    cards: periodCards(revenue, collections === undefined ? undefined : collectedCard(collected, collections.failed)),
    months: chartMonths(revenue, collected),
  }
}
