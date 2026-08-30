import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { invoicingMigrations, type InvoicingMigration } from "../cube/invoicing/index.ts"

const databaseName = "invoicing.sqlite"
const foundationMigration: InvoicingMigration = { name: "000-foundation", statements: [] }
const migrations: ReadonlyArray<InvoicingMigration> = [foundationMigration, ...invoicingMigrations]

export interface MigrationReport {
  readonly scanned: number
  readonly changed: number
  readonly skipped: number
  readonly failed: number
  readonly pending: ReadonlyArray<string>
}

export const databasePath = (dataDirectory: string) => join(dataDirectory, databaseName)

const appliedMigrations = (database: DatabaseSync): ReadonlySet<string> => {
  const table = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get()
  if (table === undefined) return new Set()
  const rows = database.prepare("SELECT name FROM schema_migrations").all()
  return new Set(rows.flatMap((row) => typeof row.name === "string" ? [row.name] : []))
}

const pendingMigrations = (database: DatabaseSync): ReadonlyArray<InvoicingMigration> => {
  const applied = appliedMigrations(database)
  return migrations.filter((migration) => !applied.has(migration.name))
}

export const planMigrations = (dataDirectory: string): MigrationReport => {
  const path = databasePath(dataDirectory)
  if (!existsSync(path)) {
    return { scanned: migrations.length, changed: 0, skipped: 0, failed: 0, pending: migrations.map(({ name }) => name) }
  }
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const pending = pendingMigrations(database)
    return {
      scanned: migrations.length,
      changed: 0,
      skipped: migrations.length - pending.length,
      failed: 0,
      pending: pending.map(({ name }) => name),
    }
  } finally {
    database.close()
  }
}

export const applyMigrations = (dataDirectory: string): MigrationReport => {
  mkdirSync(dataDirectory, { recursive: true })
  const database = new DatabaseSync(databasePath(dataDirectory))
  let transactionOpen = false
  try {
    database.exec("PRAGMA foreign_keys = ON")
    database.exec("BEGIN IMMEDIATE")
    transactionOpen = true
    database.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT",
    )
    const pending = pendingMigrations(database)
    for (const migration of pending) {
      for (const statement of migration.statements) database.exec(statement)
      database.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(migration.name, new Date().toISOString())
    }
    database.exec("COMMIT")
    transactionOpen = false
    return {
      scanned: migrations.length,
      changed: pending.length,
      skipped: migrations.length - pending.length,
      failed: 0,
      pending: [],
    }
  } catch (error) {
    if (transactionOpen) database.exec("ROLLBACK")
    throw error
  } finally {
    database.close()
  }
}

export const databaseReady = (dataDirectory: string): boolean => {
  const path = databasePath(dataDirectory)
  if (!existsSync(path)) return false
  const database = new DatabaseSync(path)
  let transactionOpen = false
  try {
    database.exec("PRAGMA foreign_keys = ON")
    database.exec("BEGIN IMMEDIATE")
    transactionOpen = true
    const ready = pendingMigrations(database).length === 0
    if (ready) {
      database.prepare("UPDATE schema_migrations SET applied_at = applied_at WHERE name = ?")
        .run(migrations.at(-1)?.name ?? foundationMigration.name)
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
