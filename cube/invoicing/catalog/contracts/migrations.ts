import migrations from "./migrations.json" with { type: "json" }

export interface CatalogMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
}

export const catalogMigrations: ReadonlyArray<CatalogMigration> = migrations
