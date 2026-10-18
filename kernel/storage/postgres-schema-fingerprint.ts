import type { Pool, PoolClient } from "pg"

import { introspectSchema, type SchemaObjects } from "./postgres-schema-introspection.ts"
import { ledgerTable, type SqlExecutor } from "./postgres-migrations.ts"
import { HistoryNotReplayable, ScratchNotRolledBack, replayFingerprint } from "./postgres-schema-replay.ts"
import { migrationKey, migrationScopes } from "./postgres-migration-plans.ts"

export { HistoryNotReplayable, ScratchNotRolledBack, replayFingerprint }

/**
 * Drift detection, global because the schema is now global.
 *
 * Expected is not a stored checksum: it is what the migrations the ledger says
 * were applied actually build, replayed into a throwaway schema and introspected
 * with the same queries that introspect the live one. Actual is the live schema.
 * Drift is the symmetric difference, which is why an edited baseline is caught
 * by its effect and not by a hash nobody can explain.
 *
 * The replay itself lives in `postgres-schema-replay.ts`; this module owns the
 * ledger order, the memoised expected objects and the comparison. `schemaDrift`
 * is the one entry point that owns a connection checkout, and it either gives it
 * back or destroys it.
 */

/**
 * What the ledger says, read once and judged structurally before anything is
 * replayed.
 *
 * `missing` is the load-bearing field: a history that skipped a migration in the
 * middle and applied the ones after it CANNOT be replayed — a later statement
 * references a table the skipped migration creates — and the old code let the
 * resulting SQLSTATE 42P01 escape as a raw driver error, so `migrate` crashed
 * instead of telling the operator to recreate the database. A gap is detected
 * here, by position in the canonical order, and reported as drift.
 *
 * `unknown` is the mirror case: a ledger row no contract declares (a renamed or
 * deleted migration). Neither is ever repaired silently and neither is ignored.
 */
export interface MigrationHistory {
  readonly present: boolean
  readonly applied: ReadonlyArray<string>
  readonly missing: ReadonlyArray<string>
  readonly unknown: ReadonlyArray<string>
}

/**
 * Gaps, computed PER SCOPE and never on the flattened cross-scope order.
 *
 * The flattened version misread a normal append: a new migration added to an
 * early scope (say `customers`, scope 2 of 8) sits before every later scope's
 * applied rows, so it looked like a hole and `migrate --apply` refused with
 * "recreate the database" instead of applying it. Within one scope the order is
 * the contract's own, so a hole there is a real hole; anything after a scope's
 * high-water mark is simply pending.
 *
 * A cross-scope dependency that genuinely cannot build is still caught — the
 * replay fails and `HistoryNotReplayable` turns it into drift — so relaxing this
 * does not open a hole in the fail-closed behaviour.
 */
const missingWithinScopes = (
  recorded: ReadonlySet<string>,
  scopes: typeof migrationScopes,
): ReadonlyArray<string> =>
  scopes.flatMap(({ scope, migrations }) => {
    const keys = migrations.map(({ name }) => migrationKey(scope, name))
    const highWaterMark = keys.reduce(
      (last, key, index) => recorded.has(key) ? index : last,
      -1,
    )
    return keys.slice(0, highWaterMark + 1).filter((key) => !recorded.has(key))
  })

/**
 * The classifier, pure and injectable so the gap rule can be tested on a scope
 * with more than one migration — today every contract has exactly one baseline,
 * which makes a real within-scope hole unreachable on a live database.
 */
export const historyFrom = (
  recorded: ReadonlySet<string>,
  scopes: typeof migrationScopes = migrationScopes,
): MigrationHistory => {
  const canonical = scopes
    .flatMap(({ scope, migrations }) => migrations.map(({ name }) => migrationKey(scope, name)))
  const known = new Set(canonical)
  return {
    present: true,
    applied: canonical.filter((key) => recorded.has(key)),
    missing: missingWithinScopes(recorded, scopes),
    unknown: [...recorded].filter((key) => !known.has(key)).sort(),
  }
}

export const readHistory = async (executor: SqlExecutor): Promise<MigrationHistory> => {
  const present = await executor.query<{ readonly present: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS present",
    [ledgerTable],
  )
  if (present.rows[0]?.present !== true) {
    return { present: false, applied: [], missing: [], unknown: [] }
  }
  const { rows } = await executor.query<{ readonly scope: string; readonly name: string }>(
    `SELECT scope, name FROM ${ledgerTable}`,
  )
  return historyFrom(new Set(rows.map(({ scope, name }) => migrationKey(scope, name))))
}

/** Applied migrations, in application order, as ledger keys. */
export const appliedOrder = async (executor: SqlExecutor): Promise<ReadonlyArray<string>> =>
  (await readHistory(executor)).applied

/**
 * A corrupt history, expressed in the same vocabulary as drift so every caller
 * answers the same way: `doctor` reports it under `schemaDrift` and `ready:
 * false`, `migrate` prints "recreate the database" and exits 1, readiness is
 * false. The names are prefixed `history:` so an operator can tell a corrupt
 * ledger from an edited object at a glance.
 */
export const historyDrift = (history: MigrationHistory): ReadonlyArray<string> => [
  ...history.missing.map((key) => `history:missing:${key}`),
  ...history.unknown.map((key) => `history:unknown:${key}`),
].sort()

interface Cached {
  readonly key: string
  readonly objects: SchemaObjects
}

let expectedCache: Cached | undefined

/** Expected objects, memoised on the ordered ledger: the same history, the same answer. */
export const expectedObjects = async (
  client: PoolClient,
  keys: ReadonlyArray<string>,
): Promise<SchemaObjects> => {
  const key = keys.join("\n")
  if (expectedCache?.key === key) return expectedCache.objects
  const objects = await replayFingerprint(client, keys)
  expectedCache = { key, objects }
  return objects
}

/** Test seam: the cache is process-wide, and a test that edits a contract needs it gone. */
export const resetFingerprintCache = (): void => {
  expectedCache = undefined
}

const difference = (
  expected: SchemaObjects,
  actual: SchemaObjects,
): ReadonlyArray<string> => {
  const drifted = new Set<string>()
  const live = new Map(actual.map((entry) => [entry.name, entry.definition]))
  for (const entry of expected) {
    if (live.get(entry.name) !== entry.definition) drifted.add(entry.name)
  }
  const planned = new Map(expected.map((entry) => [entry.name, entry.definition]))
  for (const entry of actual) {
    if (!planned.has(entry.name)) drifted.add(entry.name)
  }
  return [...drifted].sort()
}

/**
 * The names whose live definition does not match the replay of the applied
 * history. Empty means the schema is explained by its ledger.
 *
 * An empty ledger is not drift: nothing is applied, so nothing can disagree.
 * `migrate` is what answers for that, through `pending`.
 */
export const schemaDriftOnClient = async (client: PoolClient): Promise<ReadonlyArray<string>> => {
  const history = await readHistory(client)
  if (!history.present || history.applied.length === 0) return historyDrift(history)
  // A structurally corrupt history is not replayed: the replay would fail on the
  // first statement that needs the skipped migration, and the operator would get
  // a driver error instead of an answer.
  const corrupt = historyDrift(history)
  if (corrupt.length > 0) return corrupt
  const actual = await introspectSchema(client, "public")
  try {
    const expected = await expectedObjects(client, history.applied)
    return difference(expected, actual)
  } catch (error) {
    // A history that does not build is drift, not a crash. A network or resource
    // failure is NOT turned into drift: it propagates, and the caller fails
    // closed on it.
    if (error instanceof HistoryNotReplayable) return [`history:not_replayable:${error.sqlState}`]
    throw error
  }
}

/**
 * The same answer, on a connection this function checks out and gives back — or
 * destroys. A replay whose ROLLBACK failed leaves the connection in an unknown
 * transaction state, and a dirty connection is never returned to the pool.
 */
export const schemaDrift = async (pool: Pool): Promise<ReadonlyArray<string>> => {
  const client = await pool.connect()
  let dirty: Error | undefined
  try {
    return await schemaDriftOnClient(client)
  } catch (error) {
    if (error instanceof ScratchNotRolledBack) dirty = error
    throw error
  } finally {
    if (dirty === undefined) client.release()
    else client.release(dirty)
  }
}
