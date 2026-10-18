import migrations from "./migrations.json" with { type: "json" }

export interface IssuerMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
}

export const issuerMigrations: ReadonlyArray<IssuerMigration> = migrations
