import { RANGE_ORDER_ISSUE, isCalendarDate, presetRange, type ReportRange } from "./report-period.ts"

/**
 * The register's period choices and the dates each one asks the server for.
 *
 * The month, last-3-months and year presets are the dashboard's (`presetRange`);
 * what is the register's own is the current week, the whole previous month and
 * year, and "Toate" — an open range, `""` at both ends, that sends neither.
 * Today is passed in (Europe/Bucharest, as `issue_date` is), so every rule here
 * is testable without a clock.
 */
export const REGISTER_PERIODS = [
  { value: "week", label: "Săptămâna curentă" },
  { value: "month", label: "Luna curentă" },
  { value: "last-month", label: "Luna trecută" },
  { value: "3m", label: "Ultimele 3 luni" },
  { value: "year", label: "Anul curent" },
  { value: "last-year", label: "Anul trecut" },
  { value: "all", label: "Toate" },
  { value: "custom", label: "Interval personalizat…" },
] as const

export type RegisterPeriod = typeof REGISTER_PERIODS[number]["value"]
export type RegisterPreset = Exclude<RegisterPeriod, "custom">

export const DEFAULT_REGISTER_PERIOD: RegisterPreset = "month"

export const OPEN_RANGE: ReportRange = { from: "", to: "" }

/** The earliest date a typed interval may name; anything before is a year still being typed. */
export const EARLIEST_REGISTER_DATE = "2000-01-01"

export const registerPeriodFrom = (value: string): RegisterPeriod | undefined =>
  REGISTER_PERIODS.find((period) => period.value === value)?.value

/** `Date.UTC` rolls month -1 back into December and day 0 back to the previous month's last day. */
const day = (year: number, monthIndex: number, date: number): string =>
  new Date(Date.UTC(year, monthIndex, date)).toISOString().slice(0, 10)

/** Monday starts the week: on a Sunday the current week began six days earlier. */
const daysSinceMonday = (year: number, monthIndex: number, date: number): number =>
  (new Date(Date.UTC(year, monthIndex, date)).getUTCDay() + 6) % 7

export const presetDateRange = (preset: RegisterPreset, today: string): ReportRange => {
  const [year, month, date] = today.split("-").map(Number) as [number, number, number]
  const current = month - 1
  switch (preset) {
    case "week": return { from: day(year, current, date - daysSinceMonday(year, current, date)), to: today }
    case "last-month": return { from: day(year, current - 1, 1), to: day(year, current, 0) }
    case "last-year": return { from: day(year - 1, 0, 1), to: day(year - 1, 11, 31) }
    case "all": return OPEN_RANGE
    case "month": case "3m": case "year": return presetRange(preset, today)
  }
}

/**
 * An end of a typed interval that may be sent: left open, or a whole calendar
 * date from 2000 on. A date input reports every keystroke of the year as a
 * date (`0002-…`, `0020-…`, `0202-…`), and none of those is asked for.
 */
export const isSendableEnd = (value: string): boolean =>
  value === "" || (isCalendarDate(value) && value >= EARLIEST_REGISTER_DATE)

/** A typed interval that can be asked for as it stands: both ends sendable and in order. */
export const isSendableRange = (range: ReportRange): boolean =>
  isSendableEnd(range.from) && isSendableEnd(range.to) && (range.from === "" || range.to === "" || range.from <= range.to)

/** Why a typed interval is not asked for, shown under the inputs; only an order that is already readable is explained. */
export const customRangeIssue = (range: ReportRange): string | undefined =>
  range.from !== "" && range.to !== "" && isSendableEnd(range.from) && isSendableEnd(range.to) && range.from > range.to
    ? RANGE_ORDER_ISSUE
    : undefined
