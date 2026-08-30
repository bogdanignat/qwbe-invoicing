export interface DocumentsMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
}

export const documentsMigrations: ReadonlyArray<DocumentsMigration> = [{
  name: "001-artifacts",
  statements: [
    `CREATE TABLE invoice_artifacts (
      invoice_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK (byte_length > 0),
      media_type TEXT NOT NULL CHECK (media_type = 'application/pdf'),
      template_version TEXT NOT NULL,
      generated_at TEXT NOT NULL
    ) STRICT`,
    "CREATE INDEX invoice_artifacts_organization ON invoice_artifacts (organization_id)",
    "CREATE INDEX invoice_artifacts_object_key ON invoice_artifacts (object_key)",
    "CREATE INDEX invoice_artifacts_sha256 ON invoice_artifacts (sha256)",
    `CREATE TRIGGER invoice_artifacts_no_update BEFORE UPDATE ON invoice_artifacts
      BEGIN SELECT RAISE(ABORT, 'invoice artifacts are immutable'); END`,
    `CREATE TRIGGER invoice_artifacts_no_delete BEFORE DELETE ON invoice_artifacts
      BEGIN SELECT RAISE(ABORT, 'invoice artifacts are immutable'); END`,
  ],
}]
