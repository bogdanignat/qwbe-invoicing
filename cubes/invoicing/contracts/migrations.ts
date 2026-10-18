import migrations from "./migrations.json" with { type: "json" }

export interface InvoicingMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
}

export const invoicingMigrations: ReadonlyArray<InvoicingMigration> = migrations
