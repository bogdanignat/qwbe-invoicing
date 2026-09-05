import coreMigrations from "./core-migrations.json" with { type: "json" }
import authoringMigrations from "./authoring-migrations.json" with { type: "json" }

import evolutionMigrations from "./evolution-migrations.json" with { type: "json" }
import proformaMigrations from "./proforma-migrations.json" with { type: "json" }
import presetMigrations from "./preset-migrations.json" with { type: "json" }
export interface InvoicingMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
  readonly foreignKeys?: "off"
}

export const invoicingMigrations: ReadonlyArray<InvoicingMigration> = [
  ...coreMigrations,
  ...evolutionMigrations,
  ...authoringMigrations as ReadonlyArray<InvoicingMigration>,
  ...proformaMigrations as ReadonlyArray<InvoicingMigration>,
  ...presetMigrations,
]
