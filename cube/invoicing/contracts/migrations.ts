import coreMigrations from "./core-migrations.json" with { type: "json" }
import authoringMigrations from "./authoring-migrations.json" with { type: "json" }

import evolutionMigrations from "./evolution-migrations.json" with { type: "json" }
import proformaMigrations from "./proforma-migrations.json" with { type: "json" }
import presetMigrations from "./preset-migrations.json" with { type: "json" }
import auditMigrations from "./audit-migrations.json" with { type: "json" }
import { documentsMigrations } from "../documents/index.ts"
import { paymentsMigrations } from "../payments/index.ts"
export interface InvoicingMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
  readonly foreignKeys?: "off"
}

// One database per level-1 cube, so one schema history: the child cubes (payments, documents)
// contribute migrations to it and this list fixes their order. Names are listed explicitly
// rather than sorted, so a new migration is placed on purpose and a typo fails at load time.
const owned: ReadonlyArray<InvoicingMigration> = [
  ...coreMigrations,
  ...evolutionMigrations,
  ...authoringMigrations as ReadonlyArray<InvoicingMigration>,
  ...proformaMigrations as ReadonlyArray<InvoicingMigration>,
  ...presetMigrations,
  ...auditMigrations,
  ...paymentsMigrations,
  ...documentsMigrations,
]
const order = [
  "001-invoice-core", "002-invoice-payments", "003-invoice-corrections", "004-invoice-delete-last",
  "005-allow-e-factura-status-update", "006-customer-soft-delete", "007-complete-invoice-authoring",
  "008-proforma-workflow", "009-proforma-direct-invoice", "010-product-presets-payment-terms",
  "011-external-api-snapshots", "012-payment-idempotency", "013-audit-trail",
  "014-invoice-artifacts", "015-proforma-artifacts", "016-drop-e-factura-status",
]
if (order.length !== owned.length) throw new Error("every owned migration must appear exactly once in the invoicing order")
export const invoicingMigrations: ReadonlyArray<InvoicingMigration> = order.map((name) => {
  const matches = owned.filter((migration) => migration.name === name)
  if (matches.length !== 1) throw new Error(`invoicing migration order names ${name} ${String(matches.length)} times`)
  return matches[0] as InvoicingMigration
})
