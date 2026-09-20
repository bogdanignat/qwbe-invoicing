import { join } from "node:path"

import { invoicingMigrations, type InvoicingMigration } from "../../cube/invoicing/index.ts"
import { catalogMigrations } from "../../cube/invoicing/catalog/index.ts"
import { customersMigrations } from "../../cube/invoicing/customers/index.ts"
import { documentsMigrations } from "../../cube/invoicing/documents/index.ts"
import { issuerMigrations } from "../../cube/invoicing/issuer/index.ts"
import { paymentsMigrations } from "../../cube/payments/index.ts"

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

const applicationMigrations: ReadonlyArray<InvoicingMigration> = [
  ...customersMigrations, ...catalogMigrations, ...issuerMigrations, ...invoicingMigrations, ...paymentsMigrations,
]
const invoicingPlan = { label: "", file: "invoicing.sqlite", migrations: [foundationMigration, ...applicationMigrations] }
const documentsPlan = { label: "documents/", file: "documents.sqlite", migrations: [foundationMigration, ...documentsMigrations] }
const sessionsPlan = { label: "sessions/", file: "sessions.sqlite", migrations: [browserSessionsMigration] }

export const migrationPlans = [invoicingPlan, documentsPlan, sessionsPlan] as const
export type MigrationPlan = typeof migrationPlans[number]

export const pathFor = (dataDirectory: string, plan: MigrationPlan) => join(dataDirectory, plan.file)
export const databasePath = (dataDirectory: string) => pathFor(dataDirectory, invoicingPlan)
export const documentsDatabasePath = (dataDirectory: string) => pathFor(dataDirectory, documentsPlan)
export const sessionsDatabasePath = (dataDirectory: string) => pathFor(dataDirectory, sessionsPlan)
