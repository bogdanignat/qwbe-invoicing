import { ValidationFailure } from "../contracts/failures.ts"
import type { DocumentSeries, DocumentSource } from "./invoice.ts"

export { isValidRomanianCui, validateBuyer, validateParty } from "../registry/domain/party-validation.ts"

export const maximumPaymentTermDays = 3650

// The product serves Romanian issuers only; "today" for fiscal rules is the Romanian calendar day.
export const organizationTimeZone = "Europe/Bucharest"
export const calendarDate = (instant: Date, timeZone: string = organizationTimeZone): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant)

const required = (value: string | undefined, field: string, issues: Array<string>) => {
  if (value === undefined || value.trim().length === 0) issues.push(`${field} is required`)
}

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

const freeText = (field: string, value: string, maximum: number, issues: Array<string>, newlines = false): void => {
  required(value, field, issues)
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

/**
 * Document remarks are optional free text. Newlines are allowed so the PDF can
 * render paragraphs; every other control character is rejected. Nothing is
 * normalised silently — the SQLite CHECK is a safety net, this is the real gate.
 */
export const validateDocumentNotes = (notes: string | null | undefined): void => {
  if (notes === null || notes === undefined) return
  const issues: Array<string> = []
  freeText("notes", notes, 500, issues, true)
  if (issues.length > 0) throw new ValidationFailure({ issues })
}
