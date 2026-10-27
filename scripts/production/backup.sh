#!/usr/bin/env bash
# Production backup: the database and the artifact tree, as one archive in BACKUP_DIR.
#
#   scripts/production/backup.sh          (deploy/systemd/qwbe-invoicing-backup.service runs this)
#
# The CLI's backup takes the maintenance key EXCLUSIVE, so `app` is stopped for the
# whole backup and started again afterwards, also when the backup fails or on INT/TERM
# (after the current command ends). An `app` that was not running stays stopped.
# .local/production/app-stopped is written before `app` stops and removed when it is
# started again: a run killed in between (SIGKILL, power loss) leaves it, and the next
# backup or deploy refuses until the operator has checked and started the stack.
#
# The downtime is the dump, the copy, the compression and the verification (the CLI bounds them: a 10-minute dump timeout,
# 1 GiB expanded); measure it on real data before choosing the timer's hour.
#
# Success is the CLI's own report: exit 0, `failed` 0, `copied` equal to `scanned`, the
# output that was asked for. Only then the archive gets its final name,
# qwbe-invoicing-<UTC time>.tar.gz, with qwbe-invoicing-<UTC time>.meta next to it:
# the image, its ID, the commit, ORGANIZATION_ID, the database and the data volume, no
# secret. No script ever deletes an archive: removing old ones is the operator's job.
#
# BACKUP_DIR (absolute, in .env) is created by the operator, outside the checkout,
# writable by the user running this and by the image's user (`node`, uid 1000); both
# are checked before `app` stops. Copying the archives off this host is the server
# administrator's job: they are only ever written here.
#
# deploy.sh sources this file for backup_dir_ready/backup_archive; it
# holds the host lock itself. Exit: 0 backup made, 1 refused or failed.
set -euo pipefail
# shellcheck source=scripts/production/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

APP_STOPPED=0
# `.partial-<name>` while the archive is being made: the EXIT trap removes it, also
# after INT/TERM. A SIGKILL leaves it, under a name that is not an archive.
PARTIAL=""

# Before anything stops: a real directory, writable here and by the image's user
# (checked by that user writing a file in it).
backup_dir_ready() {
  [[ -d "$BACKUP_DIR" && ! -L "$BACKUP_DIR" ]] || { warn "BACKUP_DIR is not a directory: $BACKUP_DIR"; return 1; }
  [[ -w "$BACKUP_DIR" ]] || { warn "BACKUP_DIR is not writable by $(id -un): $BACKUP_DIR"; return 1; }
  docker run --rm --network none -v "$BACKUP_DIR:/backup" --entrypoint sh "$1" \
    -c 'probe="/backup/.write-probe-$$" && : > "$probe" && rm -f "$probe"' 2>/dev/null \
    || { warn "BACKUP_DIR is not writable by the image's user (node, uid 1000): $BACKUP_DIR"; return 1; }
}

backup_meta() {
  local image="$QWBE_IMAGE:$1" id commit
  id="$(image_id "$image")" || return 1
  commit="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || commit=unknown
  printf '%s\n' "created=$(date -u +%FT%TZ)" "image=$image" "image_tag=$1" "image_id=$id" "commit=$commit" \
    "organization_id=$ORGANIZATION_ID" "database=$PGDATABASE_ACTIVE" "data_volume=$DATA_VOLUME_ACTIVE"
}

remove_partial() {
  [[ -n "$PARTIAL" ]] || return 0
  rm -f -- "$BACKUP_DIR/$PARTIAL.tar.gz" "$BACKUP_DIR/$PARTIAL.meta"
  PARTIAL=""
}

# `app` is already stopped. Sets BACKUP_FILE. A failure leaves nothing behind.
backup_archive() {
  local tag="$1" name report
  name="qwbe-invoicing-$(stamp)"
  PARTIAL=".partial-$name"
  say "backup: $BACKUP_DIR/$name.tar.gz, made by $QWBE_IMAGE:$tag"
  if ! report="$(compose_tag "$tag" run --rm --no-deps -T -v "$BACKUP_DIR:/backup" app \
      node bin/qwbe-invoicing.ts backup --output "/backup/$PARTIAL.tar.gz" --json)" \
    || ! json_ok "$QWBE_IMAGE:$tag" "r.failed === 0 && r.scanned === r.copied && r.output === '/backup/$PARTIAL.tar.gz'" <<<"$report" \
    || [[ ! -s "$BACKUP_DIR/$PARTIAL.tar.gz" ]] \
    || ! backup_meta "$tag" > "$BACKUP_DIR/$PARTIAL.meta"; then
    remove_partial
    warn "backup failed; nothing was kept"
    return 1
  fi
  mv -- "$BACKUP_DIR/$PARTIAL.meta" "$BACKUP_DIR/$name.meta"
  mv -- "$BACKUP_DIR/$PARTIAL.tar.gz" "$BACKUP_DIR/$name.tar.gz"
  PARTIAL=""
  BACKUP_FILE="$BACKUP_DIR/$name.tar.gz"
  say "backup ok: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
}

# Only an `app` this run stopped, and only once.
start_stopped_app() {
  [[ "$APP_STOPPED" == 1 ]] || return 0
  APP_STOPPED=0
  say "starting app again"
  compose start app || { warn "app did not start: docker compose logs app"; return 1; }
  app_started
  wait_app_healthy 300 && return 0
  warn "app did not come back healthy: docker compose logs app"
  return 1
}

# shellcheck disable=SC2329  # the EXIT trap
on_backup_exit() {
  remove_partial
  start_stopped_app || true
}

main() {
  [[ $# -eq 0 ]] || die "usage: scripts/production/backup.sh"
  preflight
  refuse_pending
  local running image
  running="$(running_app_image || true)"
  image="$QWBE_IMAGE:$IMAGE_TAG"
  image_id "$image" >/dev/null || die "image $image (IMAGE_TAG in .env) is not on this host"
  [[ -z "$running" || "$(image_id "$image")" == "$running" ]] \
    || die "app runs image $running, but .env names $image: a backup with another version is refused"
  backup_dir_ready "$image" || die "nothing was stopped"
  trap on_backup_exit EXIT
  trap 'exit 143' TERM
  trap 'exit 130' INT
  if [[ -n "$running" ]]; then
    say "stopping app"
    APP_STOPPED=1
    stop_app backup.sh
  fi
  backup_archive "$IMAGE_TAG" || die "backup failed"
  start_stopped_app || exit 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; exit $?; fi
