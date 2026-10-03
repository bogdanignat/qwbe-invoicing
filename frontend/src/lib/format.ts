/**
 * Amounts stay the decimal strings the backend froze into the snapshot.
 *
 * Parsing them into a `number` to format them would round a fiscal total, so
 * the presentation only appends the currency the same document carries.
 */
export const money = (value: string, currency: string): string => `${value} ${currency}`

/** An absent optional field reads as a dash rather than an empty cell. */
export const orDash = (value: string | null | undefined): string =>
  value === null || value === undefined || value === "" ? "—" : value

export const today = (): string => {
  const date = new Date()
  const twoDigits = (value: number): string => String(value).padStart(2, "0")
  return `${String(date.getFullYear())}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
}

/** The zone the organization's fiscal dates are read in (cube/invoicing/domain/validation.ts:16). */
export const ORGANIZATION_TIME_ZONE = "Europe/Bucharest"

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

/**
 * How a VAT treatment is named on a document, category first.
 *
 * `RO_NON_VAT` is stored with `rate: "0.00"` because the model requires a rate
 * and the tax due really is nothing (cube/invoicing/issuer/domain/vat-catalogue.ts),
 * but `0.00%` is not what the line means and not what may be printed: an
 * article 310 issuer owes the *mention of the exemption*, and the e-Factura
 * mapper drops the rate entirely for category `O`. So the category decides the
 * label and a percentage is shown only where one exists. The only categories
 * the contract admits are `S` and `O` (cube/invoicing/domain/invoice.ts:150).
 */
export const vatTreatmentLabel = (treatment: {
  readonly vatCategoryCode: string
  readonly rate: string
}): string => treatment.vatCategoryCode === "O"
  ? "Scutit TVA — art. 310"
  : `TVA ${treatment.rate}%`
