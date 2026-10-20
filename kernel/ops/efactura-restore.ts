/**
 * What a restore does to e-Factura before it commits, whatever `QWBE_PLUGINS`
 * says (the tables exist either way). `psql --single-transaction` runs it
 * after the dump and inside the same transaction, so a database is either
 * restored with it or not restored at all.
 *
 * A backup is a picture of the past: a submission it shows `queued`,
 * `validating` or `uploading` may have reached ANAF since, so it must never
 * leave again on its own. It becomes `unknown`, its document shows `unknown`,
 * and each one gets its audit row. The OAuth attempts go too (the backup has no
 * rows of them, but an attempt must never outlive a restore); the connection
 * itself is never in a backup, so it is made again with the certificate.
 *
 * `pg_dump` empties `search_path`, hence every name is qualified. The audit id
 * is derived from the submission, so the same submission is never audited
 * twice as restored.
 */
const at = `to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
const REASON = "restaurat din backup"

export const EFACTURA_RESTORE_SQL = `
WITH restored AS (
  UPDATE public.efactura_submissions SET state='unknown', errors='["${REASON}"]', next_attempt_at=${at}, updated_at=${at}
    WHERE state IN('queued','validating','uploading') RETURNING id, organization_id, document_kind, document_id
), invoices AS (
  UPDATE public.issued_invoices AS document SET e_factura_status='unknown' FROM restored
    WHERE restored.document_kind='invoice' AND document.organization_id=restored.organization_id AND document.id=restored.document_id
), corrections AS (
  UPDATE public.correction_documents AS document SET e_factura_status='unknown' FROM restored
    WHERE restored.document_kind='correction' AND document.organization_id=restored.organization_id AND document.id=restored.document_id
)
INSERT INTO public.audit_events(id,organization_id,actor_id,occurred_at,action,target_kind,target_id,reason)
  SELECT 'efactura-restore:'||id, organization_id, 'efactura:restore', ${at}, 'efactura_submission.restored_unknown',
    'efactura_submission', id, '${REASON}' FROM restored;
DELETE FROM public.efactura_oauth_attempts;
`
