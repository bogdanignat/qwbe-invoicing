import type { NameCursor, PageQuery } from "../../cube/invoicing/index.ts"

/**
 * Query composition for the PostgreSQL adapters: numbered placeholders, the
 * ASCII fold that replaces `COLLATE NOCASE`, and the insert builder.
 *
 * SQLite took positional `?`, so a fragment could be spliced anywhere and the
 * values just had to arrive in the same order. PostgreSQL numbers its
 * parameters, so every fragment has to know where the numbering already is —
 * hence `startIndex` on each keyset helper and the `Placeholders` counter for
 * the composed statements.
 */

/** Everything the adapters bind. Dates and money travel as TEXT, booleans as 0/1. */
export type QueryValue = string | number | null

export interface SqlFragment {
  readonly sql: string
  readonly values: ReadonlyArray<QueryValue>
}

/**
 * A running placeholder number, so a statement built from several fragments
 * cannot drift: the fragment asks for the next index instead of computing it.
 */
export interface Placeholders {
  readonly next: () => string
  readonly used: () => number
}

export const placeholders = (startIndex = 1): Placeholders => {
  let index = startIndex
  return {
    next: () => {
      const current = index
      index += 1
      return `$${String(current)}`
    },
    used: () => index - startIndex,
  }
}

export const valueList = (count: number, startIndex = 1): string =>
  Array.from({ length: count }, (_, offset) => `$${String(startIndex + offset)}`).join(",")

/**
 * `COLLATE NOCASE`, as PostgreSQL can express it: fold the 26 ASCII uppercase
 * letters down and compare in `C`. The alphabet is written out because
 * `translate` takes a set of characters, not a range — `'A-Z'` would fold three
 * characters and leave the rest. SQLite's NOCASE folds ASCII only, so a
 * Romanian diacritic stays distinct on both engines.
 *
 * The expression is identical in the index (`product_presets_organization`), in
 * `ORDER BY` and in the keyset, and it is applied to BOTH operands: SQLite
 * compared the bound value case-insensitively too, so folding only the column
 * would change which rows a cursor returns.
 */
export const fold = (expression: string): string =>
  `translate(${expression},'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') COLLATE "C"`

/** The ordering the folded indexes support; `id COLLATE "C"` is the tie-break. */
export const foldedOrder = (column: string): string => `${fold(column)}, id COLLATE "C"`

export const nameKeyset = (
  page: PageQuery<NameCursor>,
  column: string,
  startIndex: number,
): SqlFragment => page.after === undefined
  ? { sql: "", values: [] }
  : {
    sql: ` AND (${fold(column)} > ${fold(`$${String(startIndex)}`)}`
      + ` OR (${fold(column)} = ${fold(`$${String(startIndex + 1)}`)} AND id COLLATE "C" > $${String(startIndex + 2)}))`,
    values: [page.after.name, page.after.name, page.after.id],
  }

export const rowsWanted = (page: PageQuery<unknown>): number => page.limit + 1

/**
 * An INSERT built from column/value pairs instead of two parallel lists.
 * The 46-column `issued_invoices` insert is the reason: a misaligned `?` list
 * is a silent data defect, and pairing makes the mistake unrepresentable.
 */
export const insertStatement = (
  table: string,
  entries: ReadonlyArray<readonly [string, QueryValue]>,
): SqlFragment => ({
  sql: `INSERT INTO ${table}(${entries.map(([column]) => column).join(",")})`
    + ` VALUES(${valueList(entries.length)})`,
  values: entries.map(([, value]) => value),
})

/** `a=excluded.a,b=excluded.b` for an upsert's DO UPDATE list. */
export const assignExcluded = (columns: ReadonlyArray<string>): string =>
  columns.map((column) => `${column}=excluded.${column}`).join(",")

/**
 * Columns and values as pairs, with the count checked: the two lists are
 * written in different places in the big inserts, and a length mismatch has to
 * fail loudly instead of shifting every column by one.
 */
export const pairs = (
  columns: ReadonlyArray<string>,
  values: ReadonlyArray<QueryValue>,
): ReadonlyArray<readonly [string, QueryValue]> => {
  if (columns.length !== values.length) {
    throw new Error(
      `column/value count mismatch: ${String(columns.length)} columns, ${String(values.length)} values`,
    )
  }
  return columns.map((column, index) => [column, values[index] ?? null] as const)
}

/**
 * Several optional fragments, numbered one after the other.
 *
 * Each builder is handed the index its own first placeholder must take, which
 * is the previous fragment's start plus however many values it actually bound —
 * an empty fragment consumes nothing. The caller then knows the next free index
 * is `startIndex + result.values.length`, which is how `LIMIT` gets its number.
 */
export const fragments = (
  startIndex: number,
  builders: ReadonlyArray<(start: number) => SqlFragment>,
): SqlFragment => {
  let index = startIndex
  let sql = ""
  const values: Array<QueryValue> = []
  for (const build of builders) {
    const fragment = build(index)
    sql += fragment.sql
    values.push(...fragment.values)
    index += fragment.values.length
  }
  return { sql, values }
}
