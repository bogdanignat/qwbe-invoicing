import { ledgerTable, type SqlExecutor } from "./postgres-migrations.ts"

/**
 * One introspection, used for both sides of the drift comparison: the live
 * `public` schema and the scratch schema the applied history is replayed into.
 * Same queries, same normalisation — a difference in the answer is a difference
 * in the schema and never a difference in how it was read.
 *
 * What is compared: tables, columns (type, nullability, default, generation),
 * constraints by name (CHECK, FK, PK, UNIQUE), indexes, triggers and function
 * bodies — the foundation function included, because a trigger that aborts is
 * only as good as the body it calls.
 *
 * What is NOT compared: OIDs, the physical schema name, and the ledger itself.
 * The scratch replay does not create the ledger, so `schema_migrations` is
 * filtered on both sides; comparing it would report the bookkeeping as drift.
 */

export interface SchemaObject {
  readonly name: string
  readonly definition: string
}

export type SchemaObjects = ReadonlyArray<SchemaObject>

/**
 * The schema name is the one thing that legitimately differs between the two
 * sides, so it is erased — both bare and quoted. Nothing else is rewritten:
 * normalising a definition any further would hide semantics.
 */
const withoutSchema = (text: string, schema: string): string =>
  text.replaceAll(`"${schema}".`, "").replaceAll(`${schema}.`, "")

const columnQuery = `SELECT c.relname AS table_name, a.attname AS column_name,
  format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null, a.attgenerated AS generated,
  pg_get_expr(d.adbin, d.adrelid) AS column_default
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = $1 AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`

const constraintQuery = `SELECT c.relname AS table_name, con.conname AS constraint_name,
  con.contype AS constraint_type, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1`

const indexQuery = `SELECT t.relname AS table_name, i.relname AS index_name,
  pg_get_indexdef(x.indexrelid) AS definition
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = i.relnamespace
WHERE n.nspname = $1`

const triggerQuery = `SELECT c.relname AS table_name, t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND NOT t.tgisinternal`

const functionQuery = `SELECT p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  format_type(p.prorettype, NULL) AS returns,
  p.provolatile AS volatility, p.proisstrict AS strict, p.prosrc AS body
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = $1`

const tableQuery = `SELECT c.relname AS table_name
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relkind = 'r'`

interface ColumnRow {
  readonly table_name: string
  readonly column_name: string
  readonly data_type: string
  readonly not_null: boolean
  readonly generated: string
  readonly column_default: string | null
}
interface ConstraintRow {
  readonly table_name: string
  readonly constraint_name: string
  readonly constraint_type: string
  readonly definition: string
}
interface IndexRow { readonly table_name: string; readonly index_name: string; readonly definition: string }
interface TriggerRow { readonly table_name: string; readonly trigger_name: string; readonly definition: string }
interface FunctionRow {
  readonly function_name: string
  readonly arguments: string
  readonly returns: string
  readonly volatility: string
  readonly strict: boolean
  readonly body: string
}

/** Everything the ledger owns: present live, absent from a replay. */
const ownedByLedger = (table: string): boolean => table === ledgerTable

export const introspectSchema = async (executor: SqlExecutor, schema: string): Promise<SchemaObjects> => {
  const clean = (text: string): string => withoutSchema(text, schema)
  const objects: Array<SchemaObject> = []

  const tables = await executor.query<{ readonly table_name: string }>(tableQuery, [schema])
  for (const row of tables.rows) {
    if (ownedByLedger(row.table_name)) continue
    objects.push({ name: `table:${row.table_name}`, definition: "present" })
  }

  const columns = await executor.query<ColumnRow>(columnQuery, [schema])
  for (const row of columns.rows) {
    if (ownedByLedger(row.table_name)) continue
    objects.push({
      name: `column:${row.table_name}.${row.column_name}`,
      definition: clean([
        row.data_type,
        row.not_null ? "NOT NULL" : "NULL",
        row.generated === "" ? "plain" : `generated:${row.generated}`,
        row.column_default === null ? "no-default" : `default:${row.column_default}`,
      ].join(" ")),
    })
  }

  const constraints = await executor.query<ConstraintRow>(constraintQuery, [schema])
  for (const row of constraints.rows) {
    if (ownedByLedger(row.table_name)) continue
    objects.push({
      name: `constraint:${row.table_name}.${row.constraint_name}`,
      definition: clean(`${row.constraint_type} ${row.definition}`),
    })
  }

  const indexes = await executor.query<IndexRow>(indexQuery, [schema])
  for (const row of indexes.rows) {
    if (ownedByLedger(row.table_name)) continue
    objects.push({ name: `index:${row.table_name}.${row.index_name}`, definition: clean(row.definition) })
  }

  const triggers = await executor.query<TriggerRow>(triggerQuery, [schema])
  for (const row of triggers.rows) {
    objects.push({ name: `trigger:${row.table_name}.${row.trigger_name}`, definition: clean(row.definition) })
  }

  const functions = await executor.query<FunctionRow>(functionQuery, [schema])
  for (const row of functions.rows) {
    objects.push({
      name: `function:${row.function_name}(${row.arguments})`,
      definition: clean(`${row.returns} ${row.volatility} ${row.strict ? "strict" : "called-on-null"} ${row.body}`),
    })
  }

  return objects.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
}
