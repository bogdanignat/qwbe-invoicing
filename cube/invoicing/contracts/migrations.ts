import coreMigrations from "./core-migrations.json" with { type: "json" }
import authoringMigrations from "./authoring-migrations.json" with { type: "json" }

import evolutionMigrations from "./evolution-migrations.json" with { type: "json" }
import proformaMigrations from "./proforma-migrations.json" with { type: "json" }
import presetMigrations from "./preset-migrations.json" with { type: "json" }
import type { InvoicingMigration } from "./migration-types.ts"

export type { InvoicingMigration } from "./migration-types.ts"

export const invoicingMigrations: ReadonlyArray<InvoicingMigration> = [
  ...coreMigrations,
  ...evolutionMigrations,
  ...authoringMigrations as ReadonlyArray<InvoicingMigration>,
  ...proformaMigrations as ReadonlyArray<InvoicingMigration>,
  ...presetMigrations,
]
