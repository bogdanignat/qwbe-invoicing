import type { ReportRange } from "./report-period.ts"

export type RegisterKindFilter = "all" | "invoice" | "correction"

/**
 * One request's worth of register filters, exactly what `GET /api/invoice-register`
 * takes. The server filters and pages; a change here is a new query from the
 * first page, never a narrowing of rows already loaded.
 */
export interface RegisterQuery {
  /** Inclusive issue dates; `""` leaves that end open. */
  readonly range: ReportRange
  readonly kind: RegisterKindFilter
  readonly search: string
  readonly limit: number
}

/** The API's limit on `q` (the cube's `maximumRegisterSearchLength`); the search input stops there. */
export const SEARCH_MAX_LENGTH = 100

export const registerPath = (query: RegisterQuery, cursor: string | undefined): string => {
  const params = new URLSearchParams()
  if (query.range.from !== "") params.set("from", query.range.from)
  if (query.range.to !== "") params.set("to", query.range.to)
  if (query.kind !== "all") params.set("kind", query.kind)
  const search = query.search.trim()
  if (search !== "") params.set("q", search)
  params.set("limit", String(query.limit))
  if (cursor !== undefined) params.set("cursor", cursor)
  return `/api/invoice-register?${params.toString()}`
}
