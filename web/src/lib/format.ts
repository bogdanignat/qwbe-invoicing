export const today = (): string => {
  const date = new Date()
  const twoDigits = (value: number): string => String(value).padStart(2, "0")
  return `${String(date.getFullYear())}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
}

// The calendar date in a given time zone, independent of the browser's own zone. Only the product
// editor uses it, to match the server's Europe/Bucharest check of a preferred VAT rate.
export const todayIn = (timeZone: string, now: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((entry) => entry.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}`
}

export const money = (value: string, currency = "RON"): string => `${value} ${currency}`
