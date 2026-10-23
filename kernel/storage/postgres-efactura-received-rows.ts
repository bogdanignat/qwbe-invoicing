import { ANAF_ENVIRONMENTS } from "../../cubes/invoicing/efactura/connection/index.ts"
import type { FetchRecord, FetchState } from "../../cubes/invoicing/efactura/received/index.ts"
import { oneOf } from "./postgres-efactura-submission-rows.ts"
import { integer, text, type Row } from "./postgres-rows.ts"

const FETCH_STATES: ReadonlyArray<FetchState> = ["listing", "downloading", "completed", "failed"]
/** The states a fetch is carried out in; the partial unique index allows one of them per organization and environment. */
export const ACTIVE_FETCH = "state IN('listing','downloading')"

export const FETCH_COLUMNS = "id,organization_id,environment,cif,window_start,window_end,gap_start,gap_end,state,pages_listed,pages_total,"
  + "found,queued,downloaded,failed,retries,errors,created_by,created_at,updated_at"

const errorsFrom = (row: Row): ReadonlyArray<string> => {
  const errors = row.errors
  if (!Array.isArray(errors) || !errors.every((error) => typeof error === "string")) throw new Error("invalid errors")
  return errors
}

/** A window without a gap stores an empty one at its start (`gap_start = gap_end`): the columns stay NOT NULL. */
const windowFrom = (row: Row): FetchRecord["window"] => {
  const window = { start: text(row, "window_start"), end: text(row, "window_end") }
  const gap = { from: text(row, "gap_start"), until: text(row, "gap_end") }
  return gap.from === gap.until ? window : { ...window, gap }
}

export const gapValues = (window: FetchRecord["window"]): readonly [string, string] =>
  window.gap === undefined ? [window.start, window.start] : [window.gap.from, window.gap.until]

export const fetchFrom = (row: Row): FetchRecord => ({
  id: text(row, "id"), organizationId: text(row, "organization_id"), environment: oneOf(ANAF_ENVIRONMENTS, row, "environment"),
  cif: text(row, "cif"), window: windowFrom(row), state: oneOf(FETCH_STATES, row, "state"),
  pagesListed: integer(row, "pages_listed"), pagesTotal: integer(row, "pages_total"), found: integer(row, "found"),
  queued: integer(row, "queued"), downloaded: integer(row, "downloaded"), failed: integer(row, "failed"), errors: errorsFrom(row),
  createdBy: text(row, "created_by"), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"),
})
