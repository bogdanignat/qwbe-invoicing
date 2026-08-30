import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

const foundationMigration = "000-foundation"
const databaseName = "invoicing.sqlite"

export interface MigrationReport {
  readonly scanned: number
  readonly changed: number
  readonly skipped: number
  readonly failed: number
  readonly pending: ReadonlyArray<string>
}

const databasePath = (dataDirectory: string) => join(dataDirectory, databaseName)

const appliedMigrations = (database: DatabaseSync): ReadonlySet<string> => {
  const table = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get()
  if (table === undefined) return new Set()
  const rows = database.prepare("SELECT name FROM schema_migrations").all()
  return new Set(rows.flatMap((row) => typeof row.name === "string" ? [row.name] : []))
}

export const planMigrations = (dataDirectory: string): MigrationReport => {
  const path = databasePath(dataDirectory)
  if (!existsSync(path)) {
    return { scanned: 1, changed: 0, skipped: 0, failed: 0, pending: [foundationMigration] }
  }

  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const pending = appliedMigrations(database).has(foundationMigration) ? [] : [foundationMigration]
    return { scanned: 1, changed: 0, skipped: 1 - pending.length, failed: 0, pending }
  } finally {
    database.close()
  }
}

export const applyMigrations = (dataDirectory: string): MigrationReport => {
  mkdirSync(dataDirectory, { recursive: true })
  const database = new DatabaseSync(databasePath(dataDirectory))
  let transactionOpen = false
  try {
    database.exec("BEGIN IMMEDIATE")
    transactionOpen = true
    database.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    )
    const alreadyApplied = appliedMigrations(database).has(foundationMigration)
    if (!alreadyApplied) {
      database.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(foundationMigration, new Date().toISOString())
    }
    database.exec("COMMIT")
    transactionOpen = false
    return {
      scanned: 1,
      changed: alreadyApplied ? 0 : 1,
      skipped: alreadyApplied ? 1 : 0,
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
    database.exec("BEGIN IMMEDIATE")
    transactionOpen = true
    const ready = appliedMigrations(database).has(foundationMigration)
    if (ready) {
      database.prepare("UPDATE schema_migrations SET applied_at = applied_at WHERE name = ?")
        .run(foundationMigration)
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
