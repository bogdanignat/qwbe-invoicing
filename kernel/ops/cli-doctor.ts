import { accessSync, constants } from "node:fs"

import type { Pool, PoolClient } from "pg"

import type { RuntimeConfig } from "../config.ts"
import { artifactsDirectoryReady, ledgerReady, planMigrations, schemaDriftOnClient } from "../storage/migrations.ts"
import { ScratchNotRolledBack } from "../storage/postgres-schema-fingerprint.ts"
import { extraSchemas } from "./postgres-backup-guards.ts"

/**
 * `doctor`, as one value. Everything it reports is observed on the real target:
 * the ledger, the drift replay, the artifact directory and the auth token file.
 *
 * The password is never in here. The connection is described by host, port,
 * database and user — the four things an operator needs to know they are looking
 * at the right server — and the secret stays in the pool that read it.
 */

export interface DoctorReport {
  readonly dataDirectory: string
  readonly writable: boolean
  readonly database: { readonly host: string; readonly port: number; readonly database: string; readonly user: string }
  readonly databaseReady: boolean
  readonly pendingMigrations: ReadonlyArray<string>
  readonly migrationsReady: boolean
  readonly schemaDrift: ReadonlyArray<string>
  /**
   * User schemas besides `public`. The application runs with them, so `ready` ignores
   * them, but `backup` refuses while one exists: non-empty means backups are failing.
   */
  readonly extraSchemas: ReadonlyArray<string>
  /**
   * Extensions besides `plpgsql`. The schema needs none, but CREATE on the database lets
   * `qwbe_app` install a trusted one, whose objects land in `public` without a new schema.
   */
  readonly extraExtensions: ReadonlyArray<string>
  readonly organizationId: string | null
  readonly authTokenFile: string | null
  readonly authTokenReadable: boolean
  readonly nodeVersion: string
  /** The one field the exit code is derived from. */
  readonly ready: boolean
}

const extraExtensions = async (client: PoolClient): Promise<ReadonlyArray<string>> => {
  const { rows } = await client.query<{ readonly extname: string }>(
    "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname",
  )
  return rows.map(({ extname }) => extname)
}

const readable = (path: string | undefined): boolean => {
  if (path === undefined) return false
  try {
    accessSync(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/**
 * One connection, one pass. The three answers used to be three checkouts and two
 * full introspections of `public` — `databaseReady` recomputed the ledger and
 * the drift the other two had just computed. `ready` is now derived from the
 * values already in hand.
 */
export const doctorReport = async (config: RuntimeConfig, pool: Pool): Promise<DoctorReport> => {
  const writable = artifactsDirectoryReady(config.dataDirectory)
  const client = await pool.connect()
  let dirty: Error | undefined
  let pending: ReadonlyArray<string>
  let drift: ReadonlyArray<string>
  let ledger: boolean
  let extra: ReadonlyArray<string>
  let extensions: ReadonlyArray<string>
  try {
    pending = (await planMigrations(client)).pending
    ledger = await ledgerReady(client)
    // Drift means the schema is not the one its migration history explains (an
    // object changed by hand, a ledger row removed): no further migration will
    // reconcile it, so it is inspected or restored from a backup.
    drift = await schemaDriftOnClient(client)
    extra = await extraSchemas(client)
    extensions = await extraExtensions(client)
  } catch (error) {
    if (error instanceof ScratchNotRolledBack) dirty = error
    throw error
  } finally {
    if (dirty === undefined) client.release()
    else client.release(dirty)
  }
  const ready = ledger && pending.length === 0 && drift.length === 0
  return {
    dataDirectory: config.dataDirectory,
    writable,
    database: {
      host: config.pgSettings.host,
      port: config.pgSettings.port,
      database: config.pgSettings.database,
      user: config.pgSettings.user,
    },
    databaseReady: ready,
    pendingMigrations: pending,
    migrationsReady: pending.length === 0,
    schemaDrift: drift,
    extraSchemas: extra,
    extraExtensions: extensions,
    organizationId: config.organizationId ?? null,
    authTokenFile: config.authTokenFile ?? null,
    authTokenReadable: readable(config.authTokenFile),
    nodeVersion: process.versions.node,
    ready: writable && ready,
  }
}
