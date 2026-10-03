#!/bin/sh
# PostgreSQL 16 probes for T-1480 step 0b. Runs INSIDE the probe container of
# compose.pg-probe.yaml (the pinned Node base image), against the throwaway
# cluster of that same compose project.
#
# Scope: answer the blocking questions of step 0b with observed output —
#   (b) is a PostgreSQL 16 client available in the pinned base image, and is
#       `pg_dump` really 16 (must-pass; a miss stops the step, no fallback)
#   (a) does PG16 accept a composite DEFERRABLE INITIALLY DEFERRED foreign key
#       whose referencing column is GENERATED ... STORED, inside an FK cycle
#   (f) does `IS JSON` agree with SQLite's `json_valid` over the same vectors
#   (c) what the real `tar` in this image does with the flags the ops code uses
#       and with hostile member names
#
# Side effects: creates synthetic tables in the probe database, writes under
# /tmp inside the container, installs the client package in the container's own
# writable layer. Nothing touches the repository (bound read-only) or any
# application volume. Output is plain text on stdout; the caller redirects it.
#
# Exit codes: 0 all probes ran, 3 the must-pass client gate failed.
set -eu

section() { printf '\n########## %s\n' "$1"; }
sql() {
  label="$1"
  shift
  printf '\n--- %s\n' "${label}"
  if psql -X -q -At -F'|' -v ON_ERROR_STOP=1 -v VERBOSITY=verbose "$@" 2>&1; then
    printf 'exit=0\n'
  else
    printf 'exit=%s\n' "$?"
  fi
}

section "0 environment"
cat /etc/alpine-release
node --version
echo "client package requested: ${POSTGRESQL_CLIENT_PACKAGE}"

section "b client 16 in the pinned image (must-pass)"
# The pipeline status would be `tail`'s, so apk's own status is read directly:
# an index rotation (-r1) or a missing network must reach the STOP below with
# exit 3, not fall through to a 127 from a missing pg_dump.
if apk add --no-cache "${POSTGRESQL_CLIENT_PACKAGE}" >/tmp/apk.log 2>&1; then
  tail -3 /tmp/apk.log
else
  tail -5 /tmp/apk.log
  echo "STOP: installing ${POSTGRESQL_CLIENT_PACKAGE} failed (index rotation or no network); step 0b halts here."
  exit 3
fi
pg_dump --version
psql --version
dump_major="$(pg_dump --version | sed -n 's/^pg_dump (PostgreSQL) \([0-9]*\).*/\1/p')"
psql_major="$(psql --version | sed -n 's/^psql (PostgreSQL) \([0-9]*\).*/\1/p')"
echo "pg_dump major=${dump_major} psql major=${psql_major}"
if [ "${dump_major}" != "16" ] || [ "${psql_major}" != "16" ]; then
  echo "STOP: the pinned image does not provide a PostgreSQL 16 client; step 0b halts here."
  exit 3
fi
sql "server version and cluster collation" \
  -c "SELECT current_setting('server_version'), version()" \
  -c "SELECT datname, datcollate, datctype, pg_encoding_to_char(encoding) FROM pg_database WHERE datname = current_database()"

section "a composite deferrable FK on a GENERATED STORED column, inside an FK cycle"
# Every run works in its own schema, so the probe is repeatable even when the
# `db` container outlives the `probe` container (`run --rm probe` removes only
# the probe). The schema is discarded at the end of the section; `public` is
# never touched and no volume or pre-existing data is involved.
probe_schema="probe_run_$(date -u +%Y%m%d%H%M%S)_$$"
echo "probe schema: ${probe_schema}"
sql "a0 own schema for this run" \
  -c "CREATE SCHEMA ${probe_schema}" \
  -c "SELECT current_database() AS database, '${probe_schema}' AS probe_schema"
PGOPTIONS="-c search_path=${probe_schema}"
export PGOPTIONS
sql "a1 forward reference inside CREATE TABLE (expected to fail)" \
  -c "CREATE TABLE probe_forward(organization_id text NOT NULL, missing_id text, FOREIGN KEY (organization_id, missing_id) REFERENCES probe_absent(organization_id, id))"
sql "a2 reordered DDL: tables first, parent unique index, then the two closing FKs" \
  -c "CREATE TABLE probe_conversions(organization_id text NOT NULL, proforma_id text NOT NULL, resulting_invoice_id text NOT NULL, PRIMARY KEY (organization_id, proforma_id))" \
  -c "CREATE TABLE probe_invoices(id text PRIMARY KEY, organization_id text NOT NULL, draft_id text, source_proforma_id text UNIQUE, direct_source_proforma_id text GENERATED ALWAYS AS (CASE WHEN draft_id IS NULL THEN source_proforma_id END) STORED, UNIQUE (organization_id, id))" \
  -c "CREATE UNIQUE INDEX probe_conversions_lineage ON probe_conversions(organization_id, proforma_id, resulting_invoice_id)" \
  -c "ALTER TABLE probe_invoices ADD CONSTRAINT probe_invoices_conversion_fk FOREIGN KEY (organization_id, direct_source_proforma_id, id) REFERENCES probe_conversions(organization_id, proforma_id, resulting_invoice_id) DEFERRABLE INITIALLY DEFERRED" \
  -c "ALTER TABLE probe_conversions ADD CONSTRAINT probe_conversions_invoice_fk FOREIGN KEY (organization_id, resulting_invoice_id) REFERENCES probe_invoices(organization_id, id)"
sql "a3 constraint catalogue" \
  -c "SELECT conname, contype, condeferrable, condeferred, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid IN ('probe_invoices'::regclass, 'probe_conversions'::regclass) ORDER BY conname"
sql "a4 cycle insert in one transaction, child first (deferred must allow it)" \
  -c "BEGIN" \
  -c "INSERT INTO probe_invoices(id, organization_id, draft_id, source_proforma_id) VALUES ('inv-1','org-1',NULL,'pf-1')" \
  -c "INSERT INTO probe_conversions(organization_id, proforma_id, resulting_invoice_id) VALUES ('org-1','pf-1','inv-1')" \
  -c "COMMIT" \
  -c "SELECT id, draft_id, source_proforma_id, direct_source_proforma_id FROM probe_invoices ORDER BY id"
sql "a5 unmatched deferred FK must fail at COMMIT, not at INSERT" \
  -c "BEGIN" \
  -c "INSERT INTO probe_invoices(id, organization_id, draft_id, source_proforma_id) VALUES ('inv-2','org-1',NULL,'pf-2')" \
  -c "COMMIT"
sql "a6 generated value NULL (draft-sourced invoice): composite FK must not be enforced" \
  -c "INSERT INTO probe_invoices(id, organization_id, draft_id, source_proforma_id) VALUES ('inv-3','org-1','draft-1','pf-3')" \
  -c "SELECT id, draft_id, direct_source_proforma_id FROM probe_invoices ORDER BY id"
sql "a7 update of a generated column is rejected (parity with SQLite)" \
  -c "UPDATE probe_invoices SET direct_source_proforma_id = 'pf-9' WHERE id = 'inv-3'"

sql "a8 discard this run's schema, leaving the cluster as it was" \
  -c "RESET search_path" \
  -c "DROP SCHEMA ${probe_schema} CASCADE" \
  -c "SELECT count(*) AS leftover_probe_schemas FROM pg_namespace WHERE nspname LIKE 'probe_run_%'"
unset PGOPTIONS

section "f IS JSON over the vectors used for json_valid parity"
# The one vector shell quoting would alter: kept byte-identical to
# probes/schema-behavior-lib.mjs through a single-quoted variable and
# dollar-quoting on the SQL side.
nul_escape='{"a":"\u0000"}'
echo "nul-escape vector sent verbatim: ${nul_escape}"
sql "f1 IS JSON predicates" -c "WITH vectors(label, value) AS (VALUES
  ('empty-object','{}'),
  ('object','{\"a\":1}'),
  ('nested-object','{\"a\":{\"b\":[1,2,3]}}'),
  ('duplicate-keys','{\"a\":1,\"a\":2}'),
  ('empty-array','[]'),
  ('array','[1,2,3]'),
  ('number','1'),
  ('negative-number','-1.5e3'),
  ('leading-zero-number','01'),
  ('string','\"a\"'),
  ('true','true'),
  ('null-literal','null'),
  ('empty-string',''),
  ('whitespace',' '),
  ('unquoted-key','{a:1}'),
  ('single-quoted','{''a'':1}'),
  ('truncated-array','[1,2,'),
  ('trailing-comma','[1,2,]'),
  ('nan','NaN'),
  ('trailing-garbage','{\"a\":1} x'),
  ('utf8-text','{\"a\":\"ăîșț\"}'),
  ('bom-prefixed',E'﻿{\"a\":1}'),
  ('nul-escape',\$json\$${nul_escape}\$json\$)
) SELECT label, value IS JSON AS is_json, value IS JSON VALUE AS is_value, value IS JSON SCALAR AS is_scalar,
         value IS JSON OBJECT AS is_object, value IS JSON ARRAY AS is_array,
         value IS JSON WITH UNIQUE KEYS AS unique_keys
  FROM vectors ORDER BY label"
sql "f2 NULL input" -c "SELECT (NULL::text IS JSON) AS null_is_json, (NULL::text IS NOT JSON) AS null_is_not_json"
sql "f3 cast comparison: what ::json rejects" \
  -c "SELECT '{a:1}'::json"
sql "f4 the nul-escape vector: predicate vs ::json vs ::jsonb" \
  -c "SELECT (\$json\$${nul_escape}\$json\$ IS JSON) AS is_json_predicate" \
  -c "SELECT \$json\$${nul_escape}\$json\$::json IS NOT NULL AS json_cast_ok" \
  -c "SELECT \$json\$${nul_escape}\$json\$::jsonb IS NOT NULL AS jsonb_cast_ok"

section "c tar in the real image"
echo "--- identity"
tar --help 2>&1 | head -3 || true
busybox | head -1 || true
echo "--- flags the ops code uses: -czf -C . and -xzf -C"
mkdir -p /tmp/tarsrc/artifacts /tmp/tarout /tmp/tarext
printf 'db' > /tmp/tarsrc/invoicing.sqlite
printf 'pdf' > /tmp/tarsrc/artifacts/one.pdf
( cd /tmp && tar -czf /tmp/tarout/backup.tar.gz -C /tmp/tarsrc . && echo "create exit=0" )
tar -xzf /tmp/tarout/backup.tar.gz -C /tmp/tarext && echo "extract exit=0"
find /tmp/tarext | sort
echo "--- listing of hostile member names (raw lines, delimited)"
node /app/scripts/pg16-probe-tar-fixture.mjs /tmp/tarout/hostile.tar
gzip -c /tmp/tarout/hostile.tar > /tmp/tarout/hostile.tar.gz
echo "names only (tar -tzf):"
tar -tzf /tmp/tarout/hostile.tar.gz 2>&1 | sed 's/^/  [/;s/$/]/'
echo "verbose (tar -tzvf):"
tar -tzvf /tmp/tarout/hostile.tar.gz 2>&1 | sed 's/^/  [/;s/$/]/'
echo "--- extraction of the hostile archive into an empty staging directory"
# Extraction targets a nested `stage/`, and the parent is listed: a member that
# escaped the staging directory would show up next to it instead of silently
# landing outside everything the probe looks at.
mkdir -p /tmp/tarhostile/stage
tar -xzf /tmp/tarout/hostile.tar.gz -C /tmp/tarhostile/stage >/tmp/tarhostile.log 2>&1
extract_status=$?
sed 's/^/  /' /tmp/tarhostile.log
echo "  extract exit=${extract_status}"
find /tmp/tarhostile | sort | sed 's/^/  /'
ls -l /tmp/tarhostile/stage 2>/dev/null | sed 's/^/  /'
echo "--- option parsing probe (parsing only; semantics are not asserted here)"
for flag in --numeric-owner --no-same-owner --no-same-permissions --absolute-names --exclude=nothing --warning=none; do
  if tar -tzf /tmp/tarout/backup.tar.gz "${flag}" >/dev/null 2>&1; then
    echo "  ${flag}: accepted by the option parser"
  else
    echo "  ${flag}: rejected by the option parser"
  fi
done

section "done"
echo "all probes ran"
