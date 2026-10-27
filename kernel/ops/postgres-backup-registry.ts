import { ledgerTable } from "../storage/postgres-migrations.ts"
import { isMigrationKey } from "./postgres-backup-manifest-fields.ts"
import { ArchiveRejected } from "./postgres-backup-paths.ts"

/**
 * The restored ledger against the manifest, inside the restore's own transaction.
 *
 * `psql --single-transaction` runs this after the dump and the e-Factura step and
 * before the COMMIT (`restoreDatabase`), so a dump whose `schema_migrations` is not
 * EXACTLY the set the manifest claims raises, and the whole restore rolls back with
 * both differences in the message. Checked after the commit instead, a mismatch
 * would leave a database whose ledger the manifest does not describe.
 *
 * The keys come from a parsed manifest, so each is already `scope/name` in a
 * character set that cannot close a literal or the dollar quote; it is asserted
 * again here because this is where they become SQL.
 */
const literal = (key: string): string => {
  if (!isMigrationKey(key)) throw new ArchiveRejected(`manifest schema key is not scope/name: ${JSON.stringify(key)}`)
  return `'${key}'`
}

export const registryCheckSql = (keys: ReadonlyArray<string>): string => `
DO $registry$
DECLARE
  expected text[] := ARRAY[${keys.map(literal).join(",")}]::text[];
  manifest_only text;
  database_only text;
BEGIN
  SELECT string_agg(key, ', ' ORDER BY key) INTO manifest_only FROM unnest(expected) AS key
    WHERE key NOT IN (SELECT scope || '/' || name FROM public.${ledgerTable});
  SELECT string_agg(scope || '/' || name, ', ' ORDER BY scope, name) INTO database_only FROM public.${ledgerTable}
    WHERE scope || '/' || name <> ALL (expected);
  IF manifest_only IS NOT NULL OR database_only IS NOT NULL THEN
    RAISE EXCEPTION 'restored schema_migrations differs from the manifest; only in the manifest: %; only in the database: %',
      coalesce(manifest_only, '(none)'), coalesce(database_only, '(none)');
  END IF;
END
$registry$;
`
