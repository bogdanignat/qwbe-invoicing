import migrations from "./migrations.json" with { type: "json" }

export interface ConnectionMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
}

export const connectionMigrations: ReadonlyArray<ConnectionMigration> = migrations
