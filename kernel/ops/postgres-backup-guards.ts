import type { PoolClient } from "pg"

import { ledgerTable } from "../storage/postgres-migrations.ts"

/**
 * The conditions a backup or a restore is allowed to run under, all read from the
 * one connection the operation holds the exclusive maintenance lock on.
 *
 * `pg_stat_activity` is read for the refusal message and for nothing else. No
 * backend is cancelled and none is terminated: the barrier is the advisory lock,
 * and an operation that cannot take it refuses instead of clearing the way.
 */

export class GuardRefusal extends Error {
  override readonly name = "GuardRefusal"
}

export const assertServerMajor16 = async (client: PoolClient): Promise<string> => {
  const { rows } = await client.query<{ readonly version: string; readonly number: string }>(
    "SELECT current_setting('server_version') AS version, current_setting('server_version_num') AS number",
  )
  const version = rows[0]?.version ?? ""
  const major = Math.floor(Number(rows[0]?.number ?? "0") / 10_000)
  if (major !== 16) throw new GuardRefusal(`server must be major 16, found: ${version}`)
  return version
}

/** The applied migrations, in ledger order: the schema the dump describes. */
export const readSchemaMigrations = async (client: PoolClient): Promise<ReadonlyArray<string>> => {
  const { rows } = await client.query<{ readonly name: string }>(
    `SELECT name FROM ${ledgerTable} ORDER BY name`,
  )
  return rows.map((row) => row.name)
}

/** Informational: how many application backends the server currently sees. */
export const applicationBackends = async (client: PoolClient): Promise<number> => {
  const { rows } = await client.query<{ readonly count: string }>(
    `SELECT count(*) AS count FROM pg_stat_activity
     WHERE datname = current_database() AND application_name = 'qwbe-invoicing' AND pid <> pg_backend_pid()`,
  )
  return Number(rows[0]?.count ?? "0")
}

/**
 * Empty means empty, not "no table I recognise".
 *
 * Relations, routines and standalone types are all counted, across every schema
 * that is not the catalogue's, and any extra schema is counted too. An object this
 * code has no name for is still an object, and restoring a dump on top of it would
 * either collide or silently merge two schemas — so an unknown object is a
 * refusal, exactly like a known one.
 */
const inventoryQuery = `
  WITH scope AS (
    SELECT oid, nspname FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg\\_%'
  )
  SELECT 'relations' AS kind, count(*) AS count FROM pg_class c JOIN scope s ON s.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  UNION ALL
  SELECT 'routines', count(*) FROM pg_proc p JOIN scope s ON s.oid = p.pronamespace
  UNION ALL
  SELECT 'types', count(*) FROM pg_type t JOIN scope s ON s.oid = t.typnamespace
    WHERE t.typtype IN ('e', 'd', 'r') OR (t.typtype = 'c' AND t.typrelid = 0)
  UNION ALL
  SELECT 'schemas', count(*) FROM scope WHERE nspname <> 'public'
`

export const databaseInventory = async (
  client: PoolClient,
): Promise<ReadonlyArray<{ readonly kind: string; readonly count: number }>> => {
  const { rows } = await client.query<{ readonly kind: string; readonly count: string }>(inventoryQuery)
  return rows.map((row) => ({ kind: row.kind, count: Number(row.count) }))
}

/**
 * The source of a backup must have `public` and nothing else.
 *
 * This is the precondition that lets the dump be taken without `--schema=public`:
 * a whole-database dump of a database whose only user schema is `public` contains
 * exactly the `public` objects, and it does not carry the `CREATE SCHEMA "public"`
 * statement that `--schema` adds and that no fresh target can accept.
 */
export const assertSinglePublicSchema = async (client: PoolClient): Promise<void> => {
  const extra = (await databaseInventory(client)).find((entry) => entry.kind === "schemas")
  if ((extra?.count ?? 0) > 0) {
    throw new GuardRefusal(
      `backup requires public to be the only user schema; this database has ${String(extra?.count)} more`,
    )
  }
}
/**
 * The database the guards were read on IS the database the tools are pointed at.
 *
 * `plainValue` in `postgres-backup-dump.ts` already refuses a name that could be
 * read as conninfo; this closes the other half by comparing the settings handed to
 * the subprocess with `current_database()` on the locked connection.
 */
export const assertTargetMatches = async (client: PoolClient, database: string): Promise<void> => {
  const { rows } = await client.query<{ readonly name: string }>("SELECT current_database() AS name")
  const actual = rows[0]?.name ?? ""
  if (actual !== database) {
    throw new GuardRefusal(
      `the checked database (${actual}) is not the one the tools would be pointed at (${database})`,
    )
  }
}

/**
 * Every artifact the database references must be in the backup, with the content
 * its row claims.
 *
 * This is the guard that makes a silent empty collection impossible. With the
 * artifact volume not mounted the file walk yields nothing and the old code
 * reported `copied: 0, failed: 0`, exit 0 — a backup that restores a fiscal
 * database whose `invoice_artifacts` / `proforma_artifacts` rows point at PDFs that
 * do not exist. The object key is content-addressed, so comparing the key is
 * comparing the digest; the stored `sha256` is compared as well, against the digest
 * the collector computed, so a tampered or truncated file is caught too. A file
 * with no row is left alone: a content-addressed orphan from a rolled-back render
 * is harmless, a missing one is not.
 */
export const assertArtifactsComplete = async (
  client: PoolClient,
  collected: ReadonlyMap<string, string>,
): Promise<void> => {
  const { rows } = await client.query<{ readonly object_key: string; readonly sha256: string }>(`
    SELECT object_key, sha256 FROM invoice_artifacts
    UNION SELECT object_key, sha256 FROM proforma_artifacts
  `)
  const absent: Array<string> = []
  const mismatched: Array<string> = []
  for (const row of rows) {
    const member = `artifacts/${row.object_key}`
    const digest = collected.get(member)
    if (digest === undefined) absent.push(row.object_key)
    else if (digest !== row.sha256) mismatched.push(row.object_key)
  }
  if (absent.length === 0 && mismatched.length === 0) return
  const detail = [
    absent.length > 0 ? `${String(absent.length)} referenced PDFs are missing from DATA_DIR` : "",
    mismatched.length > 0 ? `${String(mismatched.length)} have a different digest than their row` : "",
  ].filter((part) => part !== "").join(", ")
  throw new GuardRefusal(
    `backup refused: ${detail}. First: ${(absent[0] ?? mismatched[0]) ?? ""}. `
    + "A backup that omits an issued document's artifact is not a backup.",
  )
}

export const assertEmptyDatabase = async (client: PoolClient): Promise<void> => {
  const populated = (await databaseInventory(client)).filter((entry) => entry.count > 0)
  if (populated.length === 0) return
  const summary = populated.map((entry) => `${entry.kind}=${String(entry.count)}`).join(" ")
  throw new GuardRefusal(
    `restore requires an empty database; this one already holds objects (${summary}). `
    + "Create a fresh database and restore into that; nothing is dropped here.",
  )
}

/**
 * After a restore the session table must exist and hold nothing. Both halves are
 * asserted: a missing table means the dump dropped a definition and `migrate`
 * would see drift, while a non-empty one means the exclusion did not apply and a
 * live cookie survived the backup.
 */
export const assertSessionsEmpty = async (client: PoolClient): Promise<void> => {
  const { rows } = await client.query<{ readonly present: boolean }>(
    "SELECT to_regclass('public.browser_sessions') IS NOT NULL AS present",
  )
  if (rows[0]?.present !== true) throw new GuardRefusal("restored schema has no public.browser_sessions table")
  const counted = await client.query<{ readonly count: string }>("SELECT count(*) AS count FROM browser_sessions")
  const count = Number(counted.rows[0]?.count ?? "-1")
  if (count !== 0) throw new GuardRefusal(`restored backup carried ${String(count)} browser sessions`)
}
