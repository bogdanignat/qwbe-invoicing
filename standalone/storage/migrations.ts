import { accessSync, constants, existsSync, mkdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import {
  databasePath, documentsDatabasePath, migrationPlans, pathFor, sessionsDatabasePath, type MigrationPlan,
} from "./sqlite-migration-plans.ts"
import { applyStatements, pendingFor, pendingPlan, schemaDrift } from "./sqlite-migration-replay.ts"

export { databasePath, documentsDatabasePath, sessionsDatabasePath, schemaDrift }

export interface MigrationReport {
  readonly scanned: number
  readonly changed: number
  readonly skipped: number
  readonly failed: number
  readonly pending: ReadonlyArray<string>
}

export const planMigrations = (dataDirectory: string): MigrationReport => {
  const pending = migrationPlans.flatMap((plan) => pendingPlan(dataDirectory, plan))
  const scanned = migrationPlans.reduce((total, plan) => total + plan.migrations.length, 0)
  return { scanned, changed: 0, skipped: scanned - pending.length, failed: 0, pending }
}

const enableWriteAheadLog = (database: DatabaseSync): void => {
  const mode = database.prepare("PRAGMA journal_mode = WAL").get()
  if (mode?.journal_mode !== "wal") throw new Error("could not enable write-ahead logging")
}

const applyPlan = (dataDirectory: string, plan: MigrationPlan): number => {
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
    if (transactionOpen) database.exec("ROLLBACK")
    throw error
  } finally {
    database.close()
  }
}

export const applyMigrations = (dataDirectory: string): MigrationReport => {
  mkdirSync(dataDirectory, { recursive: true })
  const changed = migrationPlans.reduce((total, plan) => total + applyPlan(dataDirectory, plan), 0)
  const scanned = migrationPlans.reduce((total, plan) => total + plan.migrations.length, 0)
  return { scanned, changed, skipped: scanned - changed, failed: 0, pending: [] }
}

const planReady = (dataDirectory: string, plan: MigrationPlan): boolean => {
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
  migrationPlans.every((plan) => planReady(dataDirectory, plan)) && schemaDrift(dataDirectory).length === 0
