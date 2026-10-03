import type { DocumentCursor, DocumentSource, DraftCursor, PageQuery } from "../../cube/invoicing/index.ts"
import { optionalText, type Row } from "./postgres-rows.ts"
import type { QueryValue, SqlFragment } from "./postgres-sql.ts"

/**
 * Source filtering and the document keysets, as numbered fragments.
 *
 * Each builder takes the index its first placeholder must use and binds exactly
 * as many values as it numbers, so `fragments` can chain them and the caller can
 * compute where `LIMIT` lands.
 */

export const sourceFrom = (value: Row) => {
  const app = optionalText(value, "source_app")
  const kind = optionalText(value, "source_kind")
  const id = optionalText(value, "source_id")
  if (app === undefined && kind === undefined && id === undefined) return undefined
  if (app === undefined || kind === undefined || id === undefined) throw new Error("invalid document source")
  return { app, kind, id }
}

export const sourceValues = (source: DocumentSource | undefined): ReadonlyArray<QueryValue> =>
  source === undefined ? [null, null, null] : [source.app, source.kind, source.id]

export const sourceColumns = (prefix = ""): ReadonlyArray<string> =>
  [`${prefix}source_app`, `${prefix}source_kind`, `${prefix}source_id`]

export const sourceFilter = (
  source: DocumentSource | undefined,
  startIndex: number,
  prefix = "",
): SqlFragment => source === undefined
  ? { sql: "", values: [] }
  : {
    sql: ` AND ${prefix}source_app=$${String(startIndex)} AND ${prefix}source_kind=$${String(startIndex + 1)}`
      + ` AND ${prefix}source_id=$${String(startIndex + 2)}`,
    values: [source.app, source.kind, source.id],
  }

export const documentKeyset = (
  page: PageQuery<DocumentCursor>,
  startIndex: number,
  prefix = "",
): SqlFragment => page.after === undefined
  ? { sql: "", values: [] }
  : {
    sql: ` AND (${prefix}issue_date < $${String(startIndex)}`
      + ` OR (${prefix}issue_date = $${String(startIndex + 1)} AND ${prefix}number < $${String(startIndex + 2)})`
      + ` OR (${prefix}issue_date = $${String(startIndex + 3)} AND ${prefix}number = $${String(startIndex + 4)}`
      + ` AND ${prefix}id > $${String(startIndex + 5)}))`,
    values: [
      page.after.issueDate, page.after.issueDate, page.after.number,
      page.after.issueDate, page.after.number, page.after.id,
    ],
  }

export const draftKeyset = (page: PageQuery<DraftCursor>, startIndex: number): SqlFragment =>
  page.after === undefined
    ? { sql: "", values: [] }
    : {
      sql: ` AND (issue_date < $${String(startIndex)}`
        + ` OR (issue_date = $${String(startIndex + 1)} AND id > $${String(startIndex + 2)}))`,
      values: [page.after.issueDate, page.after.issueDate, page.after.id],
    }
