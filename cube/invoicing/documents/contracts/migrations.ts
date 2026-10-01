export interface DocumentsMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
}

// PostgreSQL 16. The immutability triggers call qwbe_abort, the shared
// foundation function owned by standalone/storage, so this baseline is not
// self-sufficient SQL: the foundation scope is applied before it.
export const documentsMigrations: ReadonlyArray<DocumentsMigration> = [{
  name: "documents-001-baseline",
  statements: [
    "CREATE TABLE invoice_artifacts(invoice_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,object_key TEXT NOT NULL,sha256 TEXT NOT NULL,byte_length INTEGER NOT NULL CONSTRAINT invoice_artifacts_byte_length_positive CHECK(byte_length>0),media_type TEXT NOT NULL CONSTRAINT invoice_artifacts_media_type_pdf CHECK(media_type='application/pdf'),template_version TEXT NOT NULL,generated_at TEXT NOT NULL)",
    "CREATE INDEX invoice_artifacts_organization ON invoice_artifacts(organization_id)",
    "CREATE INDEX invoice_artifacts_object_key ON invoice_artifacts(object_key)",
    "CREATE INDEX invoice_artifacts_sha256 ON invoice_artifacts(sha256)",
    "CREATE TRIGGER invoice_artifacts_no_update BEFORE UPDATE ON invoice_artifacts FOR EACH ROW EXECUTE FUNCTION qwbe_abort('invoice artifacts are immutable')",
    "CREATE TRIGGER invoice_artifacts_no_delete BEFORE DELETE ON invoice_artifacts FOR EACH ROW EXECUTE FUNCTION qwbe_abort('invoice artifacts are immutable')",
    "CREATE TABLE proforma_artifacts(proforma_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,object_key TEXT NOT NULL,sha256 TEXT NOT NULL,byte_length INTEGER NOT NULL CONSTRAINT proforma_artifacts_byte_length_positive CHECK(byte_length>0),media_type TEXT NOT NULL CONSTRAINT proforma_artifacts_media_type_pdf CHECK(media_type='application/pdf'),template_version TEXT NOT NULL,generated_at TEXT NOT NULL)",
    "CREATE INDEX proforma_artifacts_organization ON proforma_artifacts(organization_id)",
    "CREATE INDEX proforma_artifacts_object_key ON proforma_artifacts(object_key)",
    "CREATE INDEX proforma_artifacts_sha256 ON proforma_artifacts(sha256)",
    "CREATE TRIGGER proforma_artifacts_no_update BEFORE UPDATE ON proforma_artifacts FOR EACH ROW EXECUTE FUNCTION qwbe_abort('proforma artifacts are immutable')",
    "CREATE TRIGGER proforma_artifacts_no_delete BEFORE DELETE ON proforma_artifacts FOR EACH ROW EXECUTE FUNCTION qwbe_abort('proforma artifacts are immutable')",
  ],
}]
