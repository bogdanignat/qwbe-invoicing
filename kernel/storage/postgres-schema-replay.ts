import { randomBytes } from "node:crypto"

import type { PoolClient } from "pg"

import { introspectSchema, type SchemaObjects } from "./postgres-schema-introspection.ts"
import { migrationKey, migrationScopes } from "./postgres-migration-plans.ts"

/**
 * The replay half of drift detection: the applied history, rebuilt in a scratch
 * schema and thrown away.
 *
 * One transaction, `CREATE SCHEMA <scratch>` with a random name,
 * `SET LOCAL search_path = <scratch>, pg_catalog` — deliberately WITHOUT
 * `public`, so a statement that depends on a foundation function finds the one
 * this replay just created, or fails. With `public` on the path a missing
 * dependency would silently resolve to the live object and drift would hide.
 * `ROLLBACK` runs in every case, so `public` is never written to.
 *
 * It takes a `PoolClient`, never a `Pool`: `pool.query("BEGIN")` would begin on
 * whichever connection is free and the next statement would run on another one,
 * so the scratch schema would escape the transaction and survive.
 *
 * Running DDL on the application's own connection is a deliberate, approved
 * decision: the application role owns the schema it migrates, and the scratch
 * schema is the only way to answer "is the live schema what the ledger says"
 * without trusting a stored checksum.
 */

const statementsFor = (keys: ReadonlyArray<string>): ReadonlyArray<string> => {
  const wanted = new Set(keys)
  return migrationScopes.flatMap(({ scope, migrations }) => migrations
    .filter(({ name }) => wanted.has(migrationKey(scope, name)))
    .flatMap(({ statements }) => statements))
}

const scratchName = (): string => `qwbe_drift_${randomBytes(6).toString("hex")}`

/**
 * A ROLLBACK that itself failed. The connection's transaction state is unknown
 * from here on, so the caller must destroy it instead of returning it to the
 * pool — the next caller would otherwise run inside an aborted transaction and
 * get `current transaction is aborted` until the idle timeout kills the session.
 */
export class ScratchNotRolledBack extends Error {
  override readonly name = "ScratchNotRolledBack"
  constructor() {
    super("the drift replay could not be rolled back; the connection is discarded")
  }
}

/**
 * The replay could not rebuild the history it was given. This is NOT a network
 * failure and NOT a clean "no drift": a statement referred to an object that the
 * replayed subset never creates — the signature of an applied history with a
 * hole in it, e.g. a foreign key whose parent table belongs to a migration the
 * ledger does not list.
 *
 * It is a distinct type because the three answers have three different
 * consequences: a network failure must stay a failure (readiness fails closed
 * and says so), a replay failure must become a *drift* signal so `doctor`,
 * `migrate` and readiness all say "recreate the database", and a clean replay
 * must compare. Nothing is repaired and nothing is ignored.
 */
export class HistoryNotReplayable extends Error {
  override readonly name = "HistoryNotReplayable"
  readonly sqlState: string
  constructor(sqlState: string) {
    super(`the applied migration history could not be replayed (SQLSTATE ${sqlState})`)
    this.sqlState = sqlState
  }
}

/**
 * Which SQLSTATE classes mean "this history does not build" rather than "the
 * server is unreachable or busy":
 * - class 42 (syntax error or access rule violation) — `undefined_table`,
 *   `undefined_function`, `undefined_column`, `undefined_object`: the missing
 *   dependency case;
 * - 3F000 `invalid_schema_name` — a statement qualified a schema the scratch
 *   replay does not have.
 * Everything else — class 08 (connection), 53 (insufficient resources), 57014
 * (`query_canceled`, i.e. `statement_timeout`), 25006, admin shutdown — is a
 * failure of the server or of this call, and is rethrown unchanged.
 */
const notReplayable = (error: unknown): string | undefined => {
  const code = (error as { readonly code?: unknown }).code
  if (typeof code !== "string") return undefined
  return code.startsWith("42") || code === "3F000" ? code : undefined
}

/**
 * Replays `keys` into a scratch schema and introspects it. Rolls back in every
 * case, so the connection is left exactly as it was found and `public` is never
 * written to.
 */
export const replayFingerprint = async (
  client: PoolClient,
  keys: ReadonlyArray<string>,
): Promise<SchemaObjects> => {
  const scratch = scratchName()
  await client.query("BEGIN")
  try {
    await client.query(`CREATE SCHEMA ${scratch}`)
    await client.query(`SET LOCAL search_path = ${scratch}, pg_catalog`)
    for (const statement of statementsFor(keys)) await client.query(statement)
    const objects = await introspectSchema(client, scratch)
    await client.query("ROLLBACK")
    return objects
  } catch (error) {
    // The rollback is attempted exactly once more. If it fails too, the
    // transaction state is unknown and the connection must not go back to the
    // pool — the owner destroys it on this error.
    try {
      await client.query("ROLLBACK")
    } catch {
      throw new ScratchNotRolledBack()
    }
    const sqlState = notReplayable(error)
    if (sqlState !== undefined) throw new HistoryNotReplayable(sqlState)
    throw error
  }
}
