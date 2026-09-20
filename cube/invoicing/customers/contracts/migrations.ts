import migrations from "./migrations.json" with { type: "json" }

export interface CustomersMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
}

export const customersMigrations: ReadonlyArray<CustomersMigration> = migrations
