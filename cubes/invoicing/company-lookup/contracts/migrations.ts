import migrations from "./migrations.json" with { type: "json" }

export interface CompanyLookupMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
}

export const companyLookupMigrations: ReadonlyArray<CompanyLookupMigration> = migrations
