#!/usr/bin/env bash
# Restore a backup made by backup.sh into a NEW database and a NEW data volume, then
# switch the installation to them. Nothing old is deleted or overwritten.
#
#   scripts/production/restore.sh <BACKUP_DIR/qwbe-invoicing-<time>.tar.gz>           dry-run
#   scripts/production/restore.sh <BACKUP_DIR/qwbe-invoicing-<time>.tar.gz> --apply   restore + switch
#
# The image is the one that made the backup (its .meta next to the archive): it must
# be on this host under the same tag with the same ID, and ORGANIZATION_ID must match;
# otherwise the restore is refused before anything is created. A restored database
# keeps the schema of that version, so it starts with that image and IMAGE_TAG follows.
#
# Dry-run (the default) is a preliminary check only: it creates an empty database, runs
# the CLI's restore plan against it and an empty read-only /data (structure, inventory,
# an empty target), then drops that database again once it is confirmed empty. No
# volume is made. The digests and compatibility are verified on the apply path only;
# the proof of a backup is an apply followed by doctor.
#
# --apply asks for the archive name, typed, after showing the archive and its time,
# the source, the target, the image and what is lost. Then: a new database
# <QWBE_PGDATABASE>_r<time> and volume <QWBE_DATA_VOLUME>-r<time>, restore, `doctor` on
# them; only once that is ready, `app` stops and `.env` switches QWBE_PGDATABASE,
# QWBE_DATA_VOLUME and IMAGE_TAG in one atomic write (the previous copy is kept in
# .local/production/), and the stack starts and must become ready. A target that
# failed is left as it is, for investigation; a new attempt makes a new target. The
# source database and volume stay, untouched. If the switch does not finish (INT/TERM,
# a stack that is not ready), the exit says whether `.env` was switched, where its
# previous copy is and how to start the stack; nothing is started automatically.
#
# Exit: 0 done (or dry-run passed), 1 refused or failed, 130/143 interrupted.
set -euo pipefail
# shellcheck source=scripts/production/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

meta_get() {
  local value
  value="$(sed -n "s/^$1=//p" "$META" | tail -n 1)"
  [[ "$value" =~ ^[A-Za-z0-9_.@:/-]+$ ]] || die "$META has no valid $1"
  printf '%s' "$value"
}

read_backup() {
  [[ -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || die "not a regular file: $ARCHIVE"
  NAME="$(basename "$ARCHIVE")"
  [[ "$NAME" =~ ^qwbe-invoicing-[0-9]{8}T[0-9]{6}Z\.tar\.gz$ ]] || die "not an archive made by backup.sh: $NAME"
  ARCHIVE_DIR="$(cd "$(dirname "$ARCHIVE")" && pwd)"
  [[ "$ARCHIVE_DIR" =~ ^/[^:,]*$ ]] || die "the archive's directory cannot be mounted (no ':' or ','): $ARCHIVE_DIR"
  META="$ARCHIVE_DIR/${NAME%.tar.gz}.meta"
  [[ -f "$META" && ! -L "$META" ]] || die "no $META: the image that made this backup is unknown"
  CREATED="$(meta_get created)"
  TAG="$(meta_get image_tag)"
  local id organization
  id="$(meta_get image_id)"
  organization="$(meta_get organization_id)"
  [[ "$(image_id "$QWBE_IMAGE:$TAG" || true)" == "$id" ]] \
    || die "refused: the backup was made by $QWBE_IMAGE:$TAG ($id), which is not that image on this host"
  [[ "$organization" == "$ORGANIZATION_ID" ]] \
    || die "refused: the backup belongs to ORGANIZATION_ID $organization, .env says $ORGANIZATION_ID"
  [[ -n "$(compose ps -q --status running db)" ]] || die "db is not running"
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
           made $CREATED
  image    $QWBE_IMAGE:$TAG (the one that made it)
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

# The CLI on the target (TARGET_DATA: the mount of /data), with the backup's image only.
on_target() {
  compose_tag "$TAG" run --rm --no-deps -T -e "PGDATABASE=$TARGET_DB" -v "$TARGET_DATA" "$@"
}

# database.sql is executed as the schema owner: `migrate` holds qwbe_owner's secret. It
# stages on the staging volume, as `app` does, because `migrate` has only a small /tmp.
restore_on_target() {
  on_target -e TMPDIR=/var/backups/staging -v invoicing-backup-staging:/var/backups/staging \
    -v "$ARCHIVE_DIR:/backup:ro" migrate node bin/qwbe-invoicing.ts restore --input "/backup/$NAME" "$@"
}

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
    || ! json_ok "$QWBE_IMAGE:$TAG" 'r.failed === 0 && r.dryRun === true' <<<"$report"; then
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
  local kept="target $TARGET_DB / $TARGET_VOLUME is left for investigation; the installation is unchanged; a new attempt uses a new target"
  if ! report="$(restore_on_target --apply --confirm-production --json)" \
    || ! json_ok "$QWBE_IMAGE:$TAG" 'r.failed === 0 && r.restored === r.scanned' <<<"$report"; then
    die "restore failed: $kept"
  fi
  if ! report="$(doctor_on_target)" \
    || ! json_ok "$QWBE_IMAGE:$TAG" 'r.ready === true && r.schemaDrift.length === 0' <<<"$report"; then
    die "the restored target is not ready for $QWBE_IMAGE:$TAG (doctor: $report): $kept"
  fi
  say "restored and ready on the target; switching"
  switch
}

# On any exit before the switch finished (a refusal, INT/TERM, a stack that is not
# ready): what was changed and how to go on. Nothing is started from here. Whether
# .env was switched is read from .env itself, not from how far this run thinks it got.
# shellcheck disable=SC2329  # the EXIT trap of the switch
report_switch() {
  [[ "$SWITCHING" == 1 ]] || return 0
  local stack="${COMPOSE[*]}" state=switching
  [[ "$(env_get QWBE_PGDATABASE || true)" != "$TARGET_DB" ]] || state=switched
  case "$state" in
    switching) warn "the switch did not finish: .env is NOT switched (still $PGDATABASE_ACTIVE / $DATA_VOLUME_ACTIVE / $QWBE_IMAGE:$IMAGE_TAG) and app may be stopped.
The restored target $TARGET_DB / $TARGET_VOLUME stays as it is. Nothing was started.
To start the previous stack: $stack up -d
then remove $APP_STOPPED_MARKER." ;;
    switched) warn "the switch did not finish: .env IS switched to $TARGET_DB / $TARGET_VOLUME / $QWBE_IMAGE:$TAG, but the stack was not verified ready. Nothing more is started from here.
Previous .env: $ENV_BEFORE
To go on with the restored target: $stack stop app && $stack up -d, then doctor --json
To go back to the source instead: $stack stop app && cp $ENV_BEFORE $ENV_FILE && $stack up -d
then remove $APP_STOPPED_MARKER." ;;
  esac
}

switch() {
  ENV_BEFORE="(not kept yet)"
  SWITCHING=1
  trap report_switch EXIT
  stop_app "restore.sh (switching to $TARGET_DB / $TARGET_VOLUME)" || die "could not stop app"
  ENV_BEFORE="$(env_keep restore)" || die "could not keep a copy of .env"
  env_set "QWBE_PGDATABASE=$TARGET_DB" "QWBE_DATA_VOLUME=$TARGET_VOLUME" "IMAGE_TAG=$TAG" || die "could not write .env"
  start_stack "$TAG" "r.database.database === '$TARGET_DB'" || die "switched, but the stack is not ready"
  SWITCHING=0
  rm -f "$RECOVERY_MARKER"
  say "switched to $TARGET_DB / $TARGET_VOLUME with $QWBE_IMAGE:$TAG; previous .env: $ENV_BEFORE"
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
  read_backup
  plan_target
  show_plan
  if [[ "$APPLY" == 1 ]]; then apply; else dry_run; fi
}

main "$@"; exit $?
