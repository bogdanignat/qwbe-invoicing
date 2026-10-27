/** `qwbe-invoicing help`. Kept apart from the parser in `cli.ts`, which it documents. */
export const helpText = `QWBE Invoicing operational CLI

Usage:
  qwbe-invoicing serve
  qwbe-invoicing doctor [--json]
  qwbe-invoicing migrate [--apply] [--confirm-production] [--json]
  qwbe-invoicing artifacts [--limit 50] [--apply] [--confirm-production] [--json]
  qwbe-invoicing backup --output <path.tar.gz|dir> [--json]
  qwbe-invoicing restore --input <path.tar.gz|dir> [--apply] [--confirm-production] [--json]
  qwbe-invoicing backup-inspect --input <path.tar.gz|dir> [--json]

migrate is a dry-run by default. --apply writes pending schema migrations.
artifacts reports invoices and proformas without PDFs by default. --apply renders at most
--limit documents; failures are counted and successful items remain committed for a
safe retry. Outside development, either --apply also requires --confirm-production.
backup writes a pg_dump of the database plus the DATA_DIR artifacts to a .tar.gz archive or directory. It reads
the database and writes only the archive, and repeating it produces the same contents; it takes the maintenance
barrier EXCLUSIVE, so it refuses while serve is running.
restore is a dry-run by default. --apply restores the artifacts into DATA_DIR and executes the archived
database.sql through psql as the schema owner role (qwbe_owner), NOSUPERUSER, so only an archive you trust
may be applied. A database.sql not wrapped whole in pg_dump's \\restrict ... \\unrestrict is refused, by the
dry run and by backup-inspect too, so psql runs none of its backslash meta-commands.
It takes the same barrier EXCLUSIVE and needs an EMPTY target database: create a fresh one,
point PGDATABASE at it and restore into that; nothing is ever dropped. Outside development it also requires --confirm-production.
backup records ORGANIZATION_ID in the archive; restore refuses an archive of another organization, and one whose
migrations this image does not know or has gaps in.
backup-inspect verifies an archive against its manifest and its schema against this image, with no database
and no secret: exit 0 when this image can restore it, 2 when the archive is refused or not restorable.
Exit codes: 0 success, 2 invalid input or guard refusal, 1 execution failure.
`
