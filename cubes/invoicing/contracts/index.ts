import migrations from "./migrations.json" with { type: "json" }

export * from "./host.ts"
export * from "./failures.ts"
export * from "./permissions.ts"

export interface InvoicingMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
}

export const invoicingMigrations: ReadonlyArray<InvoicingMigration> = migrations
