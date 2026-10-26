import type { EFacturaStatus } from "../../domain/invoice.ts"
import { isCalendarDate } from "./reports.ts"

export type InvoiceRegisterKind = "invoice" | "correction"

/**
 * What a client may narrow the register to. Every field is optional and an
 * absent one does not filter: `{}` is the whole register, as before the filters.
 * `from`/`to` bound `issueDate` inclusively; `search` matches series + number
 * (spaces ignored) or the customer name, case-insensitively.
 */
export interface InvoiceRegisterFilter {
  readonly from?: string | undefined
  readonly to?: string | undefined
  readonly kind?: InvoiceRegisterKind | undefined
  readonly search?: string | undefined
}

export const maximumRegisterSearchLength = 100
const registerKinds: ReadonlyArray<string> = ["invoice", "correction"] satisfies ReadonlyArray<InvoiceRegisterKind>

/** Empty when the filter can be asked for; the rule lives here so every caller (HTTP, CLI) gets it. */
export const registerFilterIssues = (filter: InvoiceRegisterFilter): ReadonlyArray<string> => {
  const issues = (["from", "to"] as const)
    .filter((field) => filter[field] !== undefined && !isCalendarDate(filter[field]))
    .map((field) => `${field} must be a calendar date in YYYY-MM-DD format`)
  if (issues.length === 0 && filter.from !== undefined && filter.to !== undefined && filter.from > filter.to) {
    issues.push("from must not be after to")
  }
  if (filter.kind !== undefined && !registerKinds.includes(filter.kind)) {
    issues.push("kind must be invoice or correction")
  }
  if (filter.search !== undefined && filter.search.length > maximumRegisterSearchLength) {
    issues.push(`q must be at most ${String(maximumRegisterSearchLength)} characters`)
  }
  if (filter.search !== undefined && /\p{Cc}/u.test(filter.search)) issues.push("q must not contain control characters")
  return issues
}

/** The filter the store runs: a blank search is no search, and the search is trimmed. */
export const normalizeRegisterFilter = (filter: InvoiceRegisterFilter): InvoiceRegisterFilter => {
  const search = filter.search?.trim()
  return { ...filter, search: search === "" ? undefined : search }
}

interface RegisterRow {
  readonly id: string
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly customer: { readonly name: string }
  readonly currency: string
  readonly totalIncludingVat: string
}

export interface InvoiceRegisterInvoiceRow extends RegisterRow {
  readonly kind: "invoice"
  readonly dueDate: string | null
  readonly eFacturaStatus: EFacturaStatus
}

export interface InvoiceRegisterCorrectionRow extends RegisterRow {
  readonly kind: "correction"
  readonly dueDate: null
  readonly eFacturaStatus: EFacturaStatus
  readonly originalReference: { readonly id: string; readonly series: string; readonly number: number }
}

export type InvoiceRegisterRow = InvoiceRegisterInvoiceRow | InvoiceRegisterCorrectionRow
export interface InvoiceRegisterCursor {
  readonly issueDate: string
  readonly number: number
  readonly id: string
  readonly kind: InvoiceRegisterKind
}
