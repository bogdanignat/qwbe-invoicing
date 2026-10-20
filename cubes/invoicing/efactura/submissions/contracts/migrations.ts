import migrations from "./migrations.json" with { type: "json" }

export interface SubmissionsMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
}

export const submissionsMigrations: ReadonlyArray<SubmissionsMigration> = migrations
