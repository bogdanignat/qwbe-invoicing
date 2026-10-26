import type { InvoiceRegisterFilter } from "../../cubes/invoicing/index.ts"
import { placeholders, type QueryValue, type SqlFragment } from "./postgres-sql.ts"

/**
 * The register filter as one numbered fragment for one half of the UNION ALL.
 *
 * The filter arrives validated and normalized by the cube; nothing here decides
 * what is allowed, it only binds. `issue_date` is TEXT in `YYYY-MM-DD`, so the
 * inclusive bounds compare as text and use `(organization_id, issue_date)`.
 *
 * The search folds case with ICU, not with the cluster's `C` ctype, which lowers
 * ASCII only: "ștefan" has to find "ȘTEFAN SRL". Series are `[A-Z0-9_-]`, so
 * series + number has no spaces and the needle drops its own ("FCT 12" = "FCT12").
 * The value is bound, never spliced, and its LIKE wildcards are escaped, so `%`
 * and `_` search for themselves.
 */
const lowered = (expression: string): string => `lower((${expression}) COLLATE "und-x-icu")`

export const escapeLike = (value: string): string => value.replace(/[\\%_]/gu, (character) => `\\${character}`)

const containing = (value: string): string => `%${escapeLike(value)}%`

export const registerFilter = (
  filter: InvoiceRegisterFilter | undefined,
  startIndex: number,
  prefix: string,
): SqlFragment => {
  const next = placeholders(startIndex)
  const values: Array<QueryValue> = []
  const bind = (value: QueryValue): string => {
    values.push(value)
    return next.next()
  }
  let sql = ""
  if (filter?.from !== undefined) sql += ` AND ${prefix}issue_date >= ${bind(filter.from)}`
  if (filter?.to !== undefined) sql += ` AND ${prefix}issue_date <= ${bind(filter.to)}`
  if (filter?.search !== undefined) {
    const pattern = (value: string): string => lowered(`${bind(containing(value))}::text`)
    const reference = lowered(`${prefix}series || ${prefix}number::text`)
    const customer = lowered(`${prefix}customer_legal_name`)
    sql += ` AND (${reference} LIKE ${pattern(filter.search.replace(/\s+/gu, ""))} ESCAPE '\\'`
      + ` OR ${customer} LIKE ${pattern(filter.search)} ESCAPE '\\')`
  }
  return { sql, values }
}
