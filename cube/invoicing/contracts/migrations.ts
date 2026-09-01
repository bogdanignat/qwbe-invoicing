import coreMigrations from "./core-migrations.json" with { type: "json" }

import { invoicingEvolutionMigrations } from "./evolution-migrations.ts"
import type { InvoicingMigration } from "./migration-types.ts"

export type { InvoicingMigration } from "./migration-types.ts"

export const invoicingMigrations: ReadonlyArray<InvoicingMigration> = [
  ...coreMigrations,
  ...invoicingEvolutionMigrations,
]
