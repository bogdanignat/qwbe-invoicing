import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import type { InvoicingMigration } from "../../cube/invoicing/index.ts"
import { migrationPlans, pathFor, type MigrationPlan } from "./sqlite-migration-plans.ts"

export const applyStatements = (database: DatabaseSync, migration: InvoicingMigration): void => {
  for (const statement of migration.statements) database.exec(statement)
}

const schemaObjects = (database: DatabaseSync): ReadonlyArray<string> => database.prepare(
  `SELECT type, name, COALESCE(sql, '') AS sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY type, name`,
).all().map((row) => `${String(row.type)} ${String(row.name)} ${String(row.sql)}`)

export const appliedMigrations = (database: DatabaseSync): ReadonlySet<string> => {
  const table = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get()
  if (table === undefined) return new Set()
  const rows = database.prepare("SELECT name FROM schema_migrations").all()
  return new Set(rows.flatMap((row) => typeof row.name === "string" ? [row.name] : []))
}

type ContractSchema = { readonly objects: ReadonlyArray<string> } | { readonly unreplayable: string }

const replayContract = (applied: ReadonlyArray<InvoicingMigration>): ContractSchema => {
  const database = new DatabaseSync(":memory:")
  try {
    for (const migration of applied) {
      try { applyStatements(database, migration) } catch { return { unreplayable: migration.name } }
    }
    return { objects: schemaObjects(database) }
  } finally {
    database.close()
  }
}

const contractSchemas = new Map<string, ContractSchema>()
const contractSchema = (plan: MigrationPlan, applied: ReadonlyArray<InvoicingMigration>): ContractSchema => {
  const key = `${plan.file}|${applied.map(({ name }) => name).join(",")}`
  const cached = contractSchemas.get(key)
  if (cached !== undefined) return cached
  const schema = replayContract(applied)
  contractSchemas.set(key, schema)
  return schema
}

const driftedNames = (expected: ReadonlyArray<string>, live: ReadonlyArray<string>): ReadonlyArray<string> => {
  const names = (objects: ReadonlyArray<string>, other: ReadonlyArray<string>) => objects
    .filter((object) => !other.includes(object)).map((object) => object.split(" ")[1] as string)
  return [...new Set([...names(expected, live), ...names(live, expected)])].sort()
}

const planDrift = (dataDirectory: string, plan: MigrationPlan): ReadonlyArray<string> => {
  const path = pathFor(dataDirectory, plan)
  if (!existsSync(path)) return []
  const database = new DatabaseSync(path, { readOnly: true })
  const live = (() => {
    try { return { objects: schemaObjects(database), applied: appliedMigrations(database) } } finally { database.close() }
  })()
  const schema = contractSchema(plan, plan.migrations.filter(({ name }) => live.applied.has(name)))
  return "unreplayable" in schema ? [schema.unreplayable] : driftedNames(schema.objects, live.objects)
}

export const schemaDrift = (dataDirectory: string): ReadonlyArray<string> =>
  migrationPlans.flatMap((plan) => planDrift(dataDirectory, plan).map((name) => `${plan.label}${name}`))

export const pendingFor = (database: DatabaseSync, plan: MigrationPlan) => {
  const applied = appliedMigrations(database)
  return plan.migrations.filter((migration) => !applied.has(migration.name))
}

export const pendingPlan = (dataDirectory: string, plan: MigrationPlan): ReadonlyArray<string> => {
  const path = pathFor(dataDirectory, plan)
  if (!existsSync(path)) return plan.migrations.map(({ name }) => `${plan.label}${name}`)
  const database = new DatabaseSync(path, { readOnly: true })
  try { return pendingFor(database, plan).map(({ name }) => `${plan.label}${name}`) } finally { database.close() }
}
