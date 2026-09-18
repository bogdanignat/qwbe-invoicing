import { accessSync, constants, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { invoicingMigrations, type InvoicingMigration } from "../cube/invoicing/index.ts"
import { catalogMigrations } from "../cube/invoicing/catalog/index.ts"
import { customersMigrations } from "../cube/invoicing/customers/index.ts"
import { documentsMigrations } from "../cube/invoicing/documents/index.ts"
import { paymentsMigrations } from "../cube/payments/index.ts"

const foundationMigration: InvoicingMigration = { name: "000-foundation", statements: [] }
const browserSessionsMigration: InvoicingMigration = {
  name: "000-browser-sessions",
  statements: [
    `CREATE TABLE browser_sessions (
      session_hash TEXT PRIMARY KEY,
      credential_hash TEXT NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    ) STRICT`,
    "CREATE INDEX browser_sessions_expiry ON browser_sessions (expires_at)",
  ],
}
// Each cube owns one baseline of its tables; the list runs in cube order, the
// cube a foreign key points at before the cube that holds it, never by name.
// Customers come first because drafts reference them; the catalog has no
// foreign keys either way and sits with the other children.
const applicationMigrations: ReadonlyArray<InvoicingMigration> = [
  ...customersMigrations, ...catalogMigrations, ...invoicingMigrations, ...paymentsMigrations,
]
const invoicingPlan = { label: "", file: "invoicing.sqlite", migrations: [foundationMigration, ...applicationMigrations] }
const documentsPlan = { label: "documents/", file: "documents.sqlite", migrations: [foundationMigration, ...documentsMigrations] }
const sessionsPlan = { label: "sessions/", file: "sessions.sqlite", migrations: [browserSessionsMigration] }
const plans = [invoicingPlan, documentsPlan, sessionsPlan] as const

export interface MigrationReport {
  readonly scanned: number
  readonly changed: number
  readonly skipped: number
  readonly failed: number
  readonly pending: ReadonlyArray<string>
}

export const databasePath = (dataDirectory: string) => join(dataDirectory, invoicingPlan.file)
export const documentsDatabasePath = (dataDirectory: string) => join(dataDirectory, documentsPlan.file)
export const sessionsDatabasePath = (dataDirectory: string) => join(dataDirectory, sessionsPlan.file)

const pathFor = (dataDirectory: string, plan: typeof plans[number]) => join(dataDirectory, plan.file)

const applyStatements = (database: DatabaseSync, migration: InvoicingMigration): void => {
  for (const statement of migration.statements) database.exec(statement)
}

// A migration is recorded by name, so editing one that is already applied leaves
// a database whose schema silently disagrees with the contract: the code writes
// what the new statement allows and SQLite refuses it against the old CHECK,
// which surfaces as an opaque 500 on the first write that touches the drift.
// Comparing the live objects with the objects the contract produces turns that
// into a refusal at migrate time, where the answer is to recreate the database.
const schemaObjects = (database: DatabaseSync): ReadonlyArray<string> => database.prepare(
  `SELECT type, name, COALESCE(sql, '') AS sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY type, name`,
).all().map((row) => `${String(row.type)} ${String(row.name)} ${String(row.sql)}`)

const appliedMigrations = (database: DatabaseSync): ReadonlySet<string> => {
  const table = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get()
  if (table === undefined) return new Set()
  const rows = database.prepare("SELECT name FROM schema_migrations").all()
  return new Set(rows.flatMap((row) => typeof row.name === "string" ? [row.name] : []))
}

// Recorded history the contract cannot replay is a divergence of its own: those
// names no longer describe the database in front of us, so the migration that
// stops the replay is what the operator has to look at.
type ContractSchema = { readonly objects: ReadonlyArray<string> } | { readonly unreplayable: string }

const replayContract = (applied: ReadonlyArray<InvoicingMigration>): ContractSchema => {
  const database = new DatabaseSync(":memory:")
  try {
    for (const migration of applied) {
      try {
        applyStatements(database, migration)
      } catch {
        return { unreplayable: migration.name }
      }
    }
    return { objects: schemaObjects(database) }
  } finally {
    database.close()
  }
}

// Only the migrations this database records as applied are replayed: measuring
// against the whole contract would call every database with pending migrations
// drifted and demand a recreation that a plain migrate would have handled.
const contractSchemas = new Map<string, ContractSchema>()
const contractSchema = (plan: typeof plans[number], applied: ReadonlyArray<InvoicingMigration>): ContractSchema => {
  const key = `${plan.file}|${applied.map(({ name }) => name).join(",")}`
  const cached = contractSchemas.get(key)
  if (cached !== undefined) return cached
  const schema = replayContract(applied)
  contractSchemas.set(key, schema)
  return schema
}

// An object counts as drifted when its exact definition is missing on the other
// side, in either direction, so a dropped table and a rewritten CHECK both name
// the object the operator has to look at.
const driftedNames = (expected: ReadonlyArray<string>, live: ReadonlyArray<string>): ReadonlyArray<string> => {
  const names = (objects: ReadonlyArray<string>, other: ReadonlyArray<string>) => objects
    .filter((object) => !other.includes(object))
    .map((object) => object.split(" ")[1] as string)
  return [...new Set([...names(expected, live), ...names(live, expected)])].sort()
}

const planDrift = (dataDirectory: string, plan: typeof plans[number]): ReadonlyArray<string> => {
  const path = pathFor(dataDirectory, plan)
  if (!existsSync(path)) return []
  const database = new DatabaseSync(path, { readOnly: true })
  const live = (() => {
    try {
      return { objects: schemaObjects(database), applied: appliedMigrations(database) }
    } finally {
      database.close()
    }
  })()
  const schema = contractSchema(plan, plan.migrations.filter(({ name }) => live.applied.has(name)))
  return "unreplayable" in schema ? [schema.unreplayable] : driftedNames(schema.objects, live.objects)
}

export const schemaDrift = (dataDirectory: string): ReadonlyArray<string> =>
  plans.flatMap((plan) => planDrift(dataDirectory, plan).map((name) => `${plan.label}${name}`))

const pendingFor = (database: DatabaseSync, plan: typeof plans[number]) => {
  const applied = appliedMigrations(database)
  return plan.migrations.filter((migration) => !applied.has(migration.name))
}

const pendingPlan = (dataDirectory: string, plan: typeof plans[number]): ReadonlyArray<string> => {
  const path = pathFor(dataDirectory, plan)
  if (!existsSync(path)) return plan.migrations.map(({ name }) => `${plan.label}${name}`)
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    return pendingFor(database, plan).map(({ name }) => `${plan.label}${name}`)
  } finally {
    database.close()
  }
}

export const planMigrations = (dataDirectory: string): MigrationReport => {
  const pending = plans.flatMap((plan) => pendingPlan(dataDirectory, plan))
  const scanned = plans.reduce((total, plan) => total + plan.migrations.length, 0)
  return { scanned, changed: 0, skipped: scanned - pending.length, failed: 0, pending }
}

// Write-ahead logging lets readers proceed while a transaction writes; the mode is persistent in
// the file, so setting it here once (outside any transaction) covers every later connection.
const enableWriteAheadLog = (database: DatabaseSync): void => {
  const mode = database.prepare("PRAGMA journal_mode = WAL").get()
  if (mode?.journal_mode !== "wal") throw new Error("could not enable write-ahead logging")
}

const applyPlan = (dataDirectory: string, plan: typeof plans[number]): number => {
  const database = new DatabaseSync(pathFor(dataDirectory, plan))
  let transactionOpen = false
  try {
    database.exec("PRAGMA busy_timeout = 5000")
    database.exec("PRAGMA foreign_keys = ON")
    enableWriteAheadLog(database)
    database.exec("BEGIN IMMEDIATE")
    transactionOpen = true
    database.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT",
    )
    database.exec("COMMIT")
    transactionOpen = false
    const pending = pendingFor(database, plan)
    for (const migration of pending) {
      database.exec("BEGIN IMMEDIATE")
      transactionOpen = true
      applyStatements(database, migration)
      database.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(migration.name, new Date().toISOString())
      database.exec("COMMIT")
      transactionOpen = false
    }
    return pending.length
  } catch (error) {
    if (transactionOpen) {
      database.exec("ROLLBACK")
    }
    throw error
  } finally {
    database.close()
  }
}

export const applyMigrations = (dataDirectory: string): MigrationReport => {
  mkdirSync(dataDirectory, { recursive: true })
  const changed = plans.reduce((total, plan) => total + applyPlan(dataDirectory, plan), 0)
  const scanned = plans.reduce((total, plan) => total + plan.migrations.length, 0)
  return { scanned, changed, skipped: scanned - changed, failed: 0, pending: [] }
}

// Readiness = storage writable + migrations current. Deliberately lock-free: an earlier version
// opened BEGIN IMMEDIATE without a busy timeout and reported "not ready" whenever any other
// connection was writing, which turned every concurrent API call into a 503.
const planReady = (dataDirectory: string, plan: typeof plans[number]): boolean => {
  const path = pathFor(dataDirectory, plan)
  if (!existsSync(path)) return false
  try {
    accessSync(path, constants.W_OK)
    accessSync(dataDirectory, constants.W_OK)
  } catch {
    return false
  }
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    database.exec("PRAGMA busy_timeout = 5000")
    return pendingFor(database, plan).length === 0
  } catch {
    return false
  } finally {
    database.close()
  }
}

export const databaseReady = (dataDirectory: string): boolean =>
  plans.every((plan) => planReady(dataDirectory, plan)) && schemaDrift(dataDirectory).length === 0
