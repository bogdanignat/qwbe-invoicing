#!/usr/bin/env bash
# Restore a backup made by backup.sh into a NEW database and a NEW data volume, migrate
# it to the installed version, then switch the installation to them. Nothing old is
# deleted or overwritten.
#
#   scripts/production/restore.sh <BACKUP_DIR/qwbe-invoicing-<time>.tar.gz>           dry-run
#   scripts/production/restore.sh <BACKUP_DIR/qwbe-invoicing-<time>.tar.gz> --apply   restore + migrate + switch
#
# Any archive made by backup.sh, with the image installed now (IMAGE_TAG in .env), which
# never changes. The archive is untrusted input: before anything is created, that image
# inspects it (`backup-inspect`): a broken archive, migrations the image does not know (an
# archive newer than the image), a history with gaps, or another ORGANIZATION_ID in its
# manifest is a refusal, and nothing is made. The .meta next to the archive is for
# people only; it may be missing.
#
# Dry-run (the default) is a preliminary check only: the inspection, then an empty
# database, the CLI's restore plan against it and an empty read-only /data (structure,
# inventory, an empty target), then that database is dropped again once confirmed empty.
# No volume is made. The proof of a backup is an apply followed by doctor.
#
# --apply asks for the archive name, typed, after showing the archive and its time,
# the source, the target, the image, the migrations it will apply and what is lost.
# Then: a new database <QWBE_PGDATABASE>_r<time> and volume <QWBE_DATA_VOLUME>-r<time>,
# restore (the restored ledger must equal the manifest), `migrate --apply` (drift
# checked before and after, as `migrate` does), `doctor` on them; only once that is
# ready, `app` stops and `.env` switches QWBE_PGDATABASE and QWBE_DATA_VOLUME in one
# atomic write (the previous copy is kept in .local/production/), and the stack starts
# and must become ready. A target that failed, the migration included, is left as it
# is, for investigation, with the source and `.env` unchanged; a new attempt makes a
# new target. If the switch does not finish (INT/TERM, a stack that is not ready), the
# exit says whether `.env` was switched, where its previous copy is and how to go on;
# nothing is started automatically.
#
# Exit: 0 done (or dry-run passed), 1 refused or failed, 130/143 interrupted.
set -euo pipefail
# shellcheck source=scripts/production/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

read_archive() {
  [[ -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || die "not a regular file: $ARCHIVE"
  NAME="$(basename "$ARCHIVE")"
  [[ "$NAME" =~ ^qwbe-invoicing-([0-9]{8}T[0-9]{6}Z)\.tar\.gz$ ]] || die "not an archive made by backup.sh: $NAME"
  CREATED="${BASH_REMATCH[1]}"
  ARCHIVE_DIR="$(cd "$(dirname "$ARCHIVE")" && pwd)"
  [[ "$ARCHIVE_DIR" =~ ^/[^:,]*$ ]] || die "the archive's directory cannot be mounted (no ':' or ','): $ARCHIVE_DIR"
  IMAGE="$QWBE_IMAGE:$IMAGE_TAG"
  image_id "$IMAGE" >/dev/null || die "image $IMAGE (IMAGE_TAG in .env) is not on this host"
  [[ -n "$(compose ps -q --status running db)" ]] || die "db is not running"
}

# A failed deploy's restore runs with the image that made its backup: deploy.sh pins it
# and writes it back to .env, step 1 of recovery-required. The marker's own line, kept
# since the first format, names that image and its ID: `backup before it: <archive>
# (made by <image>, <id>)`. .env and the image on this host are checked against it, not
# the step's "done"/"FAILED": a step run by hand afterwards passes. A digest-pinned tag
# has no ID to compare, as deploy.sh does not pin one.
recovery_image_ready() {
  [[ -e "$RECOVERY_MARKER" ]] || return 0
  local made='\(made by ([^, ]+), ([^, )]+)\)$' line needed id step
  line="$(grep -m 1 '^backup before it: ' "$RECOVERY_MARKER" || true)"
  [[ "$line" =~ $made ]] || die "refused: $RECOVERY_MARKER does not name the image that made the failed deploy's backup, so it was not
written by deploy.sh. Check that IMAGE_TAG in $ENV_FILE names the version that backup is for, remove the marker, then run
the restore again; nothing was created"
  needed="${BASH_REMATCH[1]}" id="${BASH_REMATCH[2]}"
  [[ "$IMAGE" == "$needed" && ( "$needed" == *@* || "$(image_id "$IMAGE")" == "$id" ) ]] && return 0
  step="$(sed -n 's/^image: \(.*\) ([^()]*)$/\1/p' "$RECOVERY_MARKER" | head -n 1)"
  die "refused: a failed deploy waits for a restore with $needed ($id), but .env names $IMAGE ($(image_id "$IMAGE")).
Run step 1 of $RECOVERY_MARKER first:
  ${step:-set IMAGE_TAG in $ENV_FILE to ${needed#"$QWBE_IMAGE":}}
then run the restore again; nothing was created"
}

# The CLI in `migrate` with the archive's directory read-only, staging on the staging
# volume, as `app` does, because `migrate` has only a small /tmp.
with_archive() {
  compose run --rm --no-deps -T -e TMPDIR=/var/backups/staging -v invoicing-backup-staging:/var/backups/staging \
    -v "$ARCHIVE_DIR:/backup:ro" "$@"
}

# Prints a JavaScript expression of the JSON read from stdin (`r`), in the sandbox of json_ok.
json_print() {
  docker run --rm -i --network none --entrypoint node "$IMAGE" \
    -e "const r = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); console.log(String($1))"
}

# The installed image's verdict on the archive, before anything is created: integrity
# (every member held to its manifest), its schema against this image's migrations, and
# the organization in its manifest. Sets PENDING: what `migrate` will apply after it.
# The source's /data is mounted read-only: the inspection writes only to staging. Its
# stdin is empty: `run` would otherwise read the confirmation typed for --apply.
inspect_archive() {
  local report organization
  report="$(with_archive -v "$DATA_VOLUME_ACTIVE:/data:ro" migrate \
    node bin/qwbe-invoicing.ts backup-inspect --input "/backup/$NAME" --json </dev/null)" \
    || die "refused: $IMAGE cannot restore this archive (above); nothing was created"
  if ! json_ok "$IMAGE" "r.organizationId === '$ORGANIZATION_ID'" <<<"$report"; then
    organization="$(json_print 'JSON.stringify(r.organizationId)' <<<"$report")"
    die "refused: the backup belongs to organization $organization, .env says ORGANIZATION_ID $ORGANIZATION_ID; nothing was created"
  fi
  PENDING="$(json_print "r.schema.pending.join(', ') || 'none'" <<<"$report")"
}

plan_target() {
  local suffix
  suffix="r$(date -u +%Y%m%d%H%M%S)"
  TARGET_DB="$(sed -E 's/_r[0-9]{14}$//' <<<"$PGDATABASE_ACTIVE")_$suffix"
  TARGET_VOLUME="$(sed -E 's/-r[0-9]{14}$//' <<<"$DATA_VOLUME_ACTIVE")-$suffix"
  [[ "$TARGET_DB" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "target database name is not valid: $TARGET_DB"
}

show_plan() {
  cat <<PLAN
Restore $([[ "$APPLY" == 1 ]] && echo "(apply)" || echo "(dry-run, nothing is switched)")
  archive  $ARCHIVE
           made $CREATED, accepted by $IMAGE
  image    $IMAGE (IMAGE_TAG in .env; it stays)
  migrate  $PENDING
  org      $ORGANIZATION_ID
  source   database $PGDATABASE_ACTIVE, volume $DATA_VOLUME_ACTIVE (kept, untouched)
  target   database $TARGET_DB, volume $TARGET_VOLUME (new; the dry-run makes no volume)
Everything after $CREATED is not in this backup: documents, numbers, payments and
e-Factura submissions made since then are absent from the restored installation (they
remain only in the source database). Sessions and the ANAF OAuth connection are not
restored: users unlock again, e-Factura is reconnected with the certificate, and
submissions that were in flight become 'unknown'.
PLAN
}

# The superuser, over the socket of `db`: only it creates and drops databases.
psql_db() { compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d "$1" -tAc "$2"; }

create_database() {
  [[ -z "$(psql_db postgres "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'")" ]] || die "database $TARGET_DB exists"
  psql_db postgres "CREATE DATABASE $TARGET_DB OWNER qwbe_owner TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C' ENCODING 'UTF8'" >/dev/null
  say "created database $TARGET_DB"
}

# The roles' grants (deploy/postgres/grants.sql) before the archive is loaded, so every
# object it creates as qwbe_owner gets qwbe_app's rights as it is made.
grant_target() {
  compose run --rm --no-deps -T -e "PGDATABASE=$TARGET_DB" db-init >/dev/null || die "the grants on $TARGET_DB failed"
}

create_volume() {
  ! docker volume inspect "$TARGET_VOLUME" >/dev/null 2>&1 || die "volume $TARGET_VOLUME exists"
  local project
  project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$(compose ps -q db)")"
  docker volume create --label "com.docker.compose.project=$project" \
    --label com.docker.compose.volume=invoicing-data "$TARGET_VOLUME" >/dev/null
  say "created volume $TARGET_VOLUME"
}

# The CLI on the target (TARGET_DATA: the mount of /data), with the installed image.
on_target() { compose run --rm --no-deps -T -e "PGDATABASE=$TARGET_DB" -v "$TARGET_DATA" "$@"; }

# database.sql is executed as the schema owner: `migrate` holds qwbe_owner's secret.
restore_on_target() {
  with_archive -e "PGDATABASE=$TARGET_DB" -v "$TARGET_DATA" migrate \
    node bin/qwbe-invoicing.ts restore --input "/backup/$NAME" "$@"
}

# The archive's schema up to this image's: `migrate` refuses a drifted schema before
# writing and checks it again after.
migrate_target() { on_target migrate node bin/qwbe-invoicing.ts migrate --apply --confirm-production --json; }

# What the application will see: `doctor` as qwbe_app, in `app`.
doctor_on_target() { on_target app node bin/qwbe-invoicing.ts doctor --json; }

# The dry-run's database goes again, once confirmed empty; its /data was an empty
# temporary directory, mounted read-only, so no volume is ever made for a dry-run.
# shellcheck disable=SC2329  # the EXIT trap of the dry-run
remove_dry_run_target() {
  rmdir "${TARGET_DATA%%:*}" || warn "kept ${TARGET_DATA%%:*}: not empty"
  local tables
  tables="$(psql_db "$TARGET_DB" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'" || true)"
  if [[ "$tables" == 0 ]] && psql_db postgres "DROP DATABASE $TARGET_DB" >/dev/null; then
    say "removed the dry-run database $TARGET_DB"
  else
    warn "kept database $TARGET_DB: not confirmed empty"
  fi
}

dry_run() {
  local empty
  empty="$(mktemp -d)"
  chmod 755 "$empty"
  TARGET_DATA="$empty:/data:ro"
  create_database
  trap remove_dry_run_target EXIT
  grant_target
  local report
  if ! report="$(restore_on_target --json)" \
    || ! json_ok "$IMAGE" 'r.failed === 0 && r.dryRun === true' <<<"$report"; then
    die "dry-run refused the archive (see above)"
  fi
  say "dry-run ok: the archive's structure and inventory are accepted for an empty target"
}

apply() {
  local answer report
  printf 'Type the archive name (%s) to restore it: ' "$NAME"
  read -r answer || true
  [[ "$answer" == "$NAME" ]] || die "not confirmed; nothing was changed"
  create_database
  grant_target
  create_volume
  TARGET_DATA="$TARGET_VOLUME:/data"
  local kept="target $TARGET_DB / $TARGET_VOLUME is left for investigation; the source and .env are unchanged; a new attempt uses a new target"
  if ! report="$(restore_on_target --apply --confirm-production --json)" \
    || ! json_ok "$IMAGE" 'r.failed === 0 && r.restored === r.scanned' <<<"$report"; then
    die "restore failed: $kept"
  fi
  if ! report="$(migrate_target)" \
    || ! json_ok "$IMAGE" 'r.failed === 0 && r.pending.length === 0 && r.schemaDrift.length === 0' <<<"$report"; then
    die "migrate failed on the restored target (above): $kept"
  fi
  say "migrated the target to $IMAGE ($(json_print 'r.changed' <<<"$report") applied)"
  if ! report="$(doctor_on_target)" \
    || ! json_ok "$IMAGE" 'r.ready === true && r.schemaDrift.length === 0' <<<"$report"; then
    die "the restored target is not ready for $IMAGE (doctor: $report): $kept"
  fi
  say "restored and ready on the target; switching"
  switch
}

# On any exit before the switch finished (a refusal, INT/TERM, a stack that is not
# ready): what was changed and how to go on. Nothing is started from here. Whether
# .env was switched is read from .env itself, not from how far this run thinks it got.
# The target runs with $IMAGE, which .env names either way. The source does too, unless
# a failed deploy left it (recovery-required): its schema may then be another
# version's, so going back to it is not offered.
# shellcheck disable=SC2329  # the EXIT trap of the switch
report_switch() {
  [[ "$SWITCHING" == 1 ]] || return 0
  local stack="${COMPOSE[*]}" source
  if [[ -e "$RECOVERY_MARKER" ]]; then
    source="Do not start the source $PGDATABASE_ACTIVE with $IMAGE: a failed deploy left it ($RECOVERY_MARKER)."
  fi
  if [[ "$(env_get QWBE_PGDATABASE || true)" != "$TARGET_DB" ]]; then
    warn "the switch did not finish: .env is NOT switched (still $PGDATABASE_ACTIVE / $DATA_VOLUME_ACTIVE, image $IMAGE) and app may be stopped.
The restored target $TARGET_DB / $TARGET_VOLUME, migrated to $IMAGE, stays as it is. Nothing was started.
${source:-To start the source again: $stack up -d, then remove $APP_STOPPED_MARKER.}
To restore again instead (a new target): scripts/production/restore.sh $ARCHIVE --apply"
  else
    warn "the switch did not finish: .env IS switched to $TARGET_DB / $TARGET_VOLUME (image $IMAGE, unchanged), but the stack was not verified ready. Nothing more is started from here.
Previous .env: $ENV_BEFORE
To go on with the restored target: $stack stop app && $stack up -d, then doctor --json, then remove $APP_STOPPED_MARKER${source:+ and $RECOVERY_MARKER}.
${source:-To go back to the source instead: $stack stop app && cp $ENV_BEFORE $ENV_FILE && $stack up -d, then remove $APP_STOPPED_MARKER.}"
  fi
}

switch() {
  ENV_BEFORE="(not kept yet)"
  SWITCHING=1
  trap report_switch EXIT
  stop_app "restore.sh (switching to $TARGET_DB / $TARGET_VOLUME)" || die "could not stop app"
  ENV_BEFORE="$(env_keep restore)" || die "could not keep a copy of .env"
  env_set "QWBE_PGDATABASE=$TARGET_DB" "QWBE_DATA_VOLUME=$TARGET_VOLUME" || die "could not write .env"
  start_stack "$IMAGE_TAG" "r.database.database === '$TARGET_DB'" || die "switched, but the stack is not ready"
  SWITCHING=0
  rm -f "$RECOVERY_MARKER"
  say "switched to $TARGET_DB / $TARGET_VOLUME with $IMAGE; previous .env: $ENV_BEFORE"
}

main() {
  ARCHIVE="${1:-}"
  APPLY=0
  [[ $# -eq 1 || ( $# -eq 2 && "$2" == --apply ) ]] || die "usage: scripts/production/restore.sh <archive> [--apply]"
  [[ $# -eq 2 ]] && APPLY=1
  preflight
  # Both paths clean up in their EXIT trap: the dry-run's empty database, the switch's report.
  trap 'exit 143' TERM
  trap 'exit 130' INT
  [[ ! -e "$APP_STOPPED_MARKER" ]] || warn "app was stopped by an operation that did not finish ($(cat "$APP_STOPPED_MARKER")).
A restore --apply ends by starting the stack on the restored target, and clears that marker."
  read_archive
  recovery_image_ready
  inspect_archive
  plan_target
  show_plan
  if [[ "$APPLY" == 1 ]]; then apply; else dry_run; fi
}

main "$@"; exit $?
