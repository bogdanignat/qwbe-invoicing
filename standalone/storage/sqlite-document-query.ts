import type { DocumentCursor, DocumentSource, DraftCursor, PageQuery } from "../../cube/invoicing/index.ts"
import { optionalText, type Row } from "./sqlite-rows.ts"

export const sourceFrom = (value: Row) => {
  const app = optionalText(value, "source_app")
  const kind = optionalText(value, "source_kind")
  const id = optionalText(value, "source_id")
  if (app === undefined && kind === undefined && id === undefined) return undefined
  if (app === undefined || kind === undefined || id === undefined) throw new Error("invalid document source")
  return { app, kind, id }
}

export const sourceValues = (source: DocumentSource | undefined): ReadonlyArray<string | null> =>
  source === undefined ? [null, null, null] : [source.app, source.kind, source.id]

export const sourceFilter = (source: DocumentSource | undefined, prefix = "") => source === undefined
  ? { sql: "", values: [] as ReadonlyArray<string> }
  : { sql: ` AND ${prefix}source_app=? AND ${prefix}source_kind=? AND ${prefix}source_id=?`, values: [source.app, source.kind, source.id] }

export const documentKeyset = (page: PageQuery<DocumentCursor>, prefix = "") => page.after === undefined
  ? { sql: "", values: [] as ReadonlyArray<string | number> }
  : { sql: ` AND (${prefix}issue_date < ? OR (${prefix}issue_date = ? AND ${prefix}number < ?) OR (${prefix}issue_date = ? AND ${prefix}number = ? AND ${prefix}id > ?))`,
    values: [page.after.issueDate, page.after.issueDate, page.after.number, page.after.issueDate, page.after.number, page.after.id] }

export const draftKeyset = (page: PageQuery<DraftCursor>) => page.after === undefined
  ? { sql: "", values: [] as ReadonlyArray<string> }
  : { sql: " AND (issue_date < ? OR (issue_date = ? AND id > ?))", values: [page.after.issueDate, page.after.issueDate, page.after.id] }
