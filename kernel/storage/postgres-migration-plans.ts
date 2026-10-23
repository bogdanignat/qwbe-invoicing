import { cube as invoicingCube, invoicingMigrations } from "../../cubes/invoicing/index.ts"
import { cube as companyLookupCube, companyLookupMigrations } from "../../cubes/invoicing/company-lookup/index.ts"
import { cube as catalogCube, catalogMigrations } from "../../cubes/invoicing/catalog/index.ts"
import { cube as customersCube, customersMigrations } from "../../cubes/invoicing/customers/index.ts"
import { cube as documentsCube, documentsMigrations } from "../../cubes/invoicing/documents/index.ts"
import { cube as connectionCube, connectionMigrations } from "../../cubes/invoicing/efactura/connection/index.ts"
import { cube as receivedCube, receivedMigrations } from "../../cubes/invoicing/efactura/received/index.ts"
import { cube as submissionsCube, submissionsMigrations } from "../../cubes/invoicing/efactura/submissions/index.ts"
import { cube as issuerCube, issuerMigrations } from "../../cubes/invoicing/issuer/index.ts"
import { cube as paymentsCube, paymentsMigrations } from "../../cubes/invoicing/payments/index.ts"
import { foundationMigrations, foundationScope, type SchemaMigration } from "./postgres-foundation.ts"

/**
 * One PostgreSQL database holds every scope, so the ledger key is
 * `(scope, name)` rather than the bare name three separate SQLite files could
 * afford. `tables` is the ownership claim: what this scope, and only this
 * scope, is allowed to create.
 */
export interface MigrationScope {
  readonly scope: string
  readonly migrations: ReadonlyArray<SchemaMigration>
  /** Owned tables. Cube scopes read their cube manifest; a host scope states its own. */
  readonly tables: ReadonlyArray<string>
}

const browserSessionsMigration: SchemaMigration = {
  name: "000-browser-sessions",
  statements: [
    "CREATE TABLE browser_sessions(session_hash TEXT PRIMARY KEY,credential_hash TEXT NOT NULL,"
    + "csrf_token TEXT NOT NULL,created_at BIGINT NOT NULL,expires_at BIGINT NOT NULL)",
    "CREATE INDEX browser_sessions_expiry ON browser_sessions(expires_at)",
  ],
}

/**
 * Application order, and it is load-bearing: the foundation function exists
 * before any trigger references it, and a cube's parents exist before its
 * foreign keys. Within `invoicing` the statement order carries the rest —
 * tables first, then the unique index the lineage key needs, then the
 * `ALTER TABLE` that closes the issued_invoices <-> proforma_invoice_conversions
 * cycle, then the trigger functions and the triggers.
 */
export const migrationScopes: ReadonlyArray<MigrationScope> = [
  { scope: foundationScope, migrations: foundationMigrations, tables: [] },
  { scope: customersCube.manifest.name, migrations: customersMigrations, tables: customersCube.manifest.tables },
  { scope: catalogCube.manifest.name, migrations: catalogMigrations, tables: catalogCube.manifest.tables },
  { scope: issuerCube.manifest.name, migrations: issuerMigrations, tables: issuerCube.manifest.tables },
  { scope: invoicingCube.manifest.name, migrations: invoicingMigrations, tables: invoicingCube.manifest.tables },
  { scope: paymentsCube.manifest.name, migrations: paymentsMigrations, tables: paymentsCube.manifest.tables },
  { scope: documentsCube.manifest.name, migrations: documentsMigrations, tables: documentsCube.manifest.tables },
  { scope: companyLookupCube.manifest.name, migrations: companyLookupMigrations, tables: companyLookupCube.manifest.tables },
  // e-Factura's tables exist whether or not the plugin is on: a restore and the
  // environment guard read them regardless of QWBE_PLUGINS.
  { scope: connectionCube.manifest.name, migrations: connectionMigrations, tables: connectionCube.manifest.tables },
  { scope: submissionsCube.manifest.name, migrations: submissionsMigrations, tables: submissionsCube.manifest.tables },
  { scope: receivedCube.manifest.name, migrations: receivedMigrations, tables: receivedCube.manifest.tables },
  // The host's own scope: no cube declares these, so the list is stated here.
  { scope: "kernel", migrations: [browserSessionsMigration], tables: ["browser_sessions"] },
]

export const migrationCount = (): number =>
  migrationScopes.reduce((total, scope) => total + scope.migrations.length, 0)

/** The ledger key of a migration, stable across scopes that reuse a name. */
export const migrationKey = (scope: string, name: string): string => `${scope}/${name}`
