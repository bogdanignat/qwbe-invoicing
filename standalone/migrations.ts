import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { invoicingMigrations, type InvoicingMigration } from "../cube/invoicing/index.ts"
import { documentsMigrations } from "../cube/invoicing/documents/index.ts"

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
const invoicingPlan = { label: "", file: "invoicing.sqlite", migrations: [foundationMigration, ...invoicingMigrations] }
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

const appliedMigrations = (database: DatabaseSync): ReadonlySet<string> => {
  const table = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get()
  if (table === undefined) return new Set()
  const rows = database.prepare("SELECT name FROM schema_migrations").all()
  return new Set(rows.flatMap((row) => typeof row.name === "string" ? [row.name] : []))
}

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

const applyPlan = (dataDirectory: string, plan: typeof plans[number]): number => {
  const database = new DatabaseSync(pathFor(dataDirectory, plan))
  let transactionOpen = false
  try {
    database.exec("PRAGMA foreign_keys = ON")
    database.exec("BEGIN IMMEDIATE")
    transactionOpen = true
    database.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT",
    )
    database.exec("COMMIT")
    transactionOpen = false
    const pending = pendingFor(database, plan)
    for (const migration of pending) {
      const foreignKeysOff = "foreignKeys" in migration && migration.foreignKeys === "off"
      if (foreignKeysOff) database.exec("PRAGMA foreign_keys = OFF")
      try {
        database.exec("BEGIN IMMEDIATE")
        transactionOpen = true
        for (const statement of migration.statements) database.exec(statement)
        if (foreignKeysOff && database.prepare("PRAGMA foreign_key_check").all().length > 0) {
          throw new Error(`foreign key check failed after ${migration.name}`)
        }
        database.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
          .run(migration.name, new Date().toISOString())
        database.exec("COMMIT")
        transactionOpen = false
      } finally {
        if (foreignKeysOff && !transactionOpen) database.exec("PRAGMA foreign_keys = ON")
      }
    }
    return pending.length
  } catch (error) {
    if (transactionOpen) {
      database.exec("ROLLBACK")
    }
    throw error
  } finally {
    try { database.exec("PRAGMA foreign_keys = ON") } finally { database.close() }
  }
}

export const applyMigrations = (dataDirectory: string): MigrationReport => {
  mkdirSync(dataDirectory, { recursive: true })
  const changed = plans.reduce((total, plan) => total + applyPlan(dataDirectory, plan), 0)
  const scanned = plans.reduce((total, plan) => total + plan.migrations.length, 0)
  return { scanned, changed, skipped: scanned - changed, failed: 0, pending: [] }
}

const planReady = (dataDirectory: string, plan: typeof plans[number]): boolean => {
  const path = pathFor(dataDirectory, plan)
  if (!existsSync(path)) return false
  const database = new DatabaseSync(path)
  let transactionOpen = false
  try {
    database.exec("PRAGMA foreign_keys = ON")
    database.exec("BEGIN IMMEDIATE")
    transactionOpen = true
    const ready = pendingFor(database, plan).length === 0
    if (ready) {
      database.prepare("UPDATE schema_migrations SET applied_at = applied_at WHERE name = ?")
        .run(plan.migrations.at(-1)?.name ?? foundationMigration.name)
    }
    database.exec("ROLLBACK")
    transactionOpen = false
    return ready
  } catch {
    if (transactionOpen) database.exec("ROLLBACK")
    return false
  } finally {
    database.close()
  }
}

export const databaseReady = (dataDirectory: string): boolean =>
  plans.every((plan) => planReady(dataDirectory, plan))
