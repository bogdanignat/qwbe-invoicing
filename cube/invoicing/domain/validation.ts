import { ValidationFailure } from "../contracts/failures.ts"
import type { DocumentSeries, DocumentSource } from "./invoice.ts"

export const maximumPaymentTermDays = 3650
export const article310VatExemptionReason = "Regim special de scutire conform art. 310 din Codul fiscal"

export const validateVatTreatment = (code: string, rate: string, category: string, reason: string | null): void => {
  const amount = /^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/.test(rate) ? Number(rate) : NaN
  const knownTaxable = ["RO_STANDARD", "RO_REDUCED", "RO_REDUCED_5"].includes(code)
  const valid = code === "RO_NON_VAT"
    ? amount === 0 && category === "O" && reason === article310VatExemptionReason
    : knownTaxable && amount > 0 && amount <= 100 && category === "S" && reason === null
  if (!valid) throw new ValidationFailure({ issues: ["Invalid VAT tuple"] })
}

export const organizationTimeZone = "Europe/Bucharest"
export const calendarDate = (instant: Date, timeZone: string = organizationTimeZone): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant)

export const validateDate = (value: string, field: string): void => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) throw new ValidationFailure({ issues: [`${field} must be a calendar date in YYYY-MM-DD format`] })
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ValidationFailure({ issues: [`${field} must be a valid calendar date`] })
  }
}

export const validateDocumentSeries = (documentSeries: DocumentSeries): void => {
  const issues: Array<string> = []
  const documentType: unknown = documentSeries.documentType
  if (documentType !== "invoice" && documentType !== "proforma") issues.push("documentType must be invoice or proforma")
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(documentSeries.series)) issues.push("series is invalid")
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

/** e-Factura counts a text the way the CIUS-RO Schematron does: XPath normalize-space
 * (only space, tab, CR and LF collapse or trim; a no-break space is a character) and
 * characters rather than UTF-16 units. Same expression as `normalizeSpace` and
 * `characterCount` in cube/efactura/decimals.ts, which this cube may not import. */
export const ciusTextLength = (value: string): number =>
  Array.from(value.replace(/[\t\n\r ]+/gu, " ").replace(/^ | $/gu, "")).length

/** BR-RO-L200 (party name), L150 (street), L050 (city), L020 (postal code), L100 (item name). */
export const CIUS_TEXT_LIMITS = { partyName: 200, street: 150, city: 50, postalCode: 20, lineDescription: 100 } as const

export const textLimit = (field: string, value: string | undefined, maximum: number, issues: Array<string>): void => {
  if (value !== undefined && ciusTextLength(value) > maximum) issues.push(`${field} must be at most ${String(maximum)} characters`)
}

/** Only where a line description is entered: totals are recomputed on read and on storno,
 * and a description stored before the limit must stay readable and correctable. */
export const validateLineDescription = (description: string): void => {
  const issues: Array<string> = []
  textLimit("description", description.trim(), CIUS_TEXT_LIMITS.lineDescription, issues)
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

const freeText = (field: string, value: string, maximum: number, issues: Array<string>, newlines = false): void => {
  if (value.trim().length === 0) issues.push(`${field} is required`)
  if (value !== value.trim()) issues.push(`${field} must not have surrounding whitespace`)
  if (value.length > maximum) issues.push(`${field} must be at most ${String(maximum)} characters`)
  if ((newlines ? /(?!\n)[\p{Cc}\p{Zl}\p{Zp}]/u : /[\p{Cc}\p{Zl}\p{Zp}]/u).test(value)) issues.push(`${field} must not contain control characters`)
}

export const validateDocumentSource = (source: DocumentSource): void => {
  const issues: Array<string> = []
  freeText("source.app", source.app, 100, issues)
  freeText("source.kind", source.kind, 100, issues)
  freeText("source.id", source.id, 255, issues)
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

export const validateDocumentNotes = (notes: string | null | undefined): void => {
  if (notes === null || notes === undefined) return
  const issues: Array<string> = []
  freeText("notes", notes, 300, issues, true)
  if (issues.length > 0) throw new ValidationFailure({ issues })
}
