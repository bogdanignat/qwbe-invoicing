/** An absent optional field reads as a dash rather than an empty cell. */
export const orDash = (value: string | null | undefined): string =>
  value === null || value === undefined || value === "" ? "—" : value

export const today = (): string => {
  const date = new Date()
  const twoDigits = (value: number): string => String(value).padStart(2, "0")
  return `${String(date.getFullYear())}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
}

/** The zone the organization's fiscal dates are read in (cubes/invoicing/domain/validation.ts:16). */
export const ORGANIZATION_TIME_ZONE = "Europe/Bucharest"

const DATE_TIME = new Intl.DateTimeFormat("ro-RO", {
  timeZone: ORGANIZATION_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
})

/** A moment the server recorded (ISO 8601), read in Europe/Bucharest; text that is no date stays as it came. */
export const dateTime = (iso: string): string => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : DATE_TIME.format(at)
}

/**
 * The calendar date in a named zone, independent of the browser's own.
 *
 * A VAT rate is retired on a date the server reads in Europe/Bucharest. Asking
 * the browser instead makes the offered rates depend on where the machine
 * thinks it is: between midnight in Bucharest and midnight in UTC on the day a
 * rate changes, a `TZ=UTC` browser would still offer the withdrawn rate the
 * server then refuses — and would hide the new one. So every decision about
 * which rate may be preferred reads the date from here.
 */
export const todayIn = (timeZone: string, now: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}`
}
