/**
 * The dashboard's period: an inclusive interval of calendar dates, at most 36
 * calendar months long — the same rule the backend enforces
 * (cubes/invoicing/corrections/domain/reports.ts), checked here so an invalid
 * custom interval is explained next to the inputs instead of coming back as a 400.
 */
export interface ReportRange {
  readonly from: string
  readonly to: string
}

export const MAXIMUM_REPORT_MONTHS = 36

export const PERIOD_PRESETS = [
  { value: "month", label: "Luna curentă" },
  { value: "3m", label: "Ultimele 3 luni" },
  { value: "6m", label: "Ultimele 6 luni" },
  { value: "12m", label: "Ultimele 12 luni" },
  { value: "year", label: "Anul curent" },
] as const

export type PeriodPreset = typeof PERIOD_PRESETS[number]["value"]

export const DEFAULT_PERIOD_PRESET: PeriodPreset = "12m"

export const isCalendarDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (match === null) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Months since year 0: `2026-01` and `2025-12` are one apart. */
const monthIndex = (date: string): number => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1

const firstDayOf = (index: number): string =>
  `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}-01`

/** How many calendar months the range touches, both ends included. */
export const rangeMonthCount = (range: ReportRange): number => monthIndex(range.to) - monthIndex(range.from) + 1

/** Why a typed interval cannot be asked for, in the words shown under the inputs; undefined when it can. */
export const rangeIssue = (range: ReportRange): string | undefined => {
  if (range.from === "" || range.to === "") return "Alege ambele date ale intervalului."
  if (!isCalendarDate(range.from) || !isCalendarDate(range.to)) return "Datele trebuie să fie zile calendaristice valide."
  if (range.from > range.to) return "Data de început nu poate fi după data de sfârșit."
  if (rangeMonthCount(range) > MAXIMUM_REPORT_MONTHS) {
    return `Intervalul poate cuprinde cel mult ${String(MAXIMUM_REPORT_MONTHS)} de luni calendaristice.`
  }
  return undefined
}

/**
 * A preset ends today (in the organization's zone, passed in) and the last N
 * months include the current one: on 2026-10-19 the last 3 months start on 2026-08-01.
 */
export const presetRange = (preset: PeriodPreset, today: string): ReportRange => {
  const current = monthIndex(today)
  const months: Readonly<Record<PeriodPreset, number>> = {
    month: 1, "3m": 3, "6m": 6, "12m": 12, year: current % 12 + 1,
  }
  return { from: firstDayOf(current - months[preset] + 1), to: today }
}
