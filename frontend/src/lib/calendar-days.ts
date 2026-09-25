/**
 * Calendar arithmetic on ISO dates, with the invalid input answered rather than
 * thrown: a due date derived from a date the user has not finished typing must
 * come back empty, never as a wrong day.
 */
export const addCalendarDays = (date: string, days: number): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isSafeInteger(days) || days < 0) return ""
  const value = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== date) return ""
  value.setUTCDate(value.getUTCDate() + days)
  if (Number.isNaN(value.getTime())) return ""
  const shifted = value.toISOString()
  return /^\d{4}-\d{2}-\d{2}T/.test(shifted) ? shifted.slice(0, 10) : ""
}
