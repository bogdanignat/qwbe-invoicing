import core from "./core-migrations.json" with { type: "json" }
import authoring from "./authoring-migrations.json" with { type: "json" }

import evolution from "./evolution-migrations.json" with { type: "json" }
import proforma from "./proforma-migrations.json" with { type: "json" }
import presets from "./preset-migrations.json" with { type: "json" }
import notes from "./document-notes-migrations.json" with { type: "json" }
import audit from "./audit-migrations.json" with { type: "json" }
import vat from "./issuer-vat-status-migrations.json" with { type: "json" }
import workflow from "./proforma-workflow-migrations.json" with { type: "json" }
import efacturaParties from "./efactura-party-migrations.json" with { type: "json" }
export interface InvoicingMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
  readonly foreignKeys?: "off"
}

export const invoicingMigrations = [
  core,
  evolution,
  authoring,
  proforma,
  presets,
  notes,
  audit,
  vat,
  workflow,
  efacturaParties,
].flat() as ReadonlyArray<InvoicingMigration>
