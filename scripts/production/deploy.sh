#!/usr/bin/env bash
# Production deploy from this checkout: an upgrade of a running installation (the
# first install is docs/RELEASE.md, "Install").
#
#   scripts/production/deploy.sh
#
#  1. Refuses unless docker, `.env` (read restrictively), the Compose files and the
#     required keys are there, the checkout is `main` and clean, `app` runs the image
#     `.env` names, and no other deploy/backup/restore holds the host lock.
#  2. Records the active version: the ID of the image `app` runs, and the commit.
#  3. `git pull --ff-only` and `docker build`, tagged ${QWBE_IMAGE}:<12-hex commit> (the
#     previous image keeps its own tag for the rollback). Then the project network must
#     have the subnets the new Compose files fix: Compose does not move a running
#     network, so a mismatch would only fail at `up`, after `app` stopped. Production
#     runs untouched until here; a failure stops the deploy without downtime.
#  4. Stops `app` and backs up with the active image (backup.sh). No backup, no
#     deploy: the previous `app` starts again and the exit is non-zero.
#  5. Only then writes the new IMAGE_TAG to `.env` and starts `migrate` and `app`;
#     waits for health and `doctor --json` ready.
#  6. On failure, the outcome of this run's `migrate` decides:
#     - nothing changed (it did not run, or its report says `changed: 0`): back to
#       the previous image and IMAGE_TAG, which must become ready again;
#     - schema changed, or unknown (no report; a `migrate` still running is stopped
#       first): the previous version is NOT started
#       on that database. `app` stays stopped, the exact restore command (this
#       deploy's backup, with the image that made it) is printed and kept in
#       .local/production/recovery-required, and deploy/backup refuse until then.
#     Every failure exits non-zero.
#  7. On success: removes ${QWBE_IMAGE}:<commit> images that are neither the current
#     one, the previous one, nor named by a backup still kept in BACKUP_DIR.
#
# `git pull` rewrites this file, lib.sh and backup.sh while they run, and bash reads
# a script as it executes it. So both libraries are sourced here, before the pull,
# and the whole body is `main`, called on the last line together with `exit`: once
# that line is read, bash never reads the file again.
set -euo pipefail
here="$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=scripts/production/lib.sh
source "$here/lib.sh"
# shellcheck source=scripts/production/backup.sh
source "$here/backup.sh"

PHASE=preflight

checkout_ready() {
  git -C "$QWBE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$QWBE_ROOT is not a git checkout"
  local branch changes
  branch="$(git -C "$QWBE_ROOT" branch --show-current)"
  [[ "$branch" == main ]] || die "the checkout is on '$branch', not main"
  changes="$(git -C "$QWBE_ROOT" status --porcelain)"
  [[ -z "$changes" ]] || die "the checkout has local changes; the image would not be the commit:
$changes"
}

record_active() {
  ACTIVE_ID="$(running_app_image || true)"
  [[ -n "$ACTIVE_ID" ]] || die "app is not running: deploy upgrades a running installation"
  OLD_TAG="$IMAGE_TAG"
  [[ "$(image_id "$QWBE_IMAGE:$OLD_TAG" || true)" == "$ACTIVE_ID" ]] \
    || die "app runs image $ACTIVE_ID, but .env names $QWBE_IMAGE:$OLD_TAG; make .env name the running version first"
  OLD_COMMIT="$(git -C "$QWBE_ROOT" rev-parse HEAD)"
  say "active: $QWBE_IMAGE:$OLD_TAG ($ACTIVE_ID), checkout $OLD_COMMIT"
}

pull_and_build() {
  say "git pull --ff-only"
  git -C "$QWBE_ROOT" pull --ff-only || die "git pull failed; production is untouched"
  local commit
  commit="$(git -C "$QWBE_ROOT" rev-parse HEAD)"
  NEW_TAG="${commit:0:12}"
  if [[ "$NEW_TAG" == "$OLD_TAG" ]]; then say "already running $NEW_TAG; nothing to deploy"; exit 0; fi
  say "building $QWBE_IMAGE:$NEW_TAG"
  docker build --label "org.opencontainers.image.revision=$commit" -t "$QWBE_IMAGE:$NEW_TAG" "$QWBE_ROOT" \
    || die "build failed; production is untouched"
  compose_tag "$NEW_TAG" config --quiet || die "the new Compose files do not accept this .env; production is untouched"
}

# The subnets of the default network as the new Compose files define it, against the
# network Docker has, exactly: compose.prod.yaml declares IPv6 only together with
# enable_ipv6, and compose.ipv4-only.yaml drops both.
network_ready() {
  local name wanted actual
  local -a network
  mapfile -t network < <(compose_tag "$NEW_TAG" config --format json \
    | docker run --rm -i --network none --entrypoint node "$QWBE_IMAGE:$NEW_TAG" -e '
      const n = JSON.parse(require("node:fs").readFileSync(0, "utf8")).networks.default
      console.log([n.name, ...(n.ipam?.config ?? []).map((c) => c.subnet)].join("\n"))')
  name="${network[0]:-}"
  [[ -n "$name" ]] || die "could not read the network of the new Compose files; production is untouched"
  wanted="$(printf '%s\n' "${network[@]:1}" | LC_ALL=C sort)"
  actual="$(docker network inspect -f '{{range .IPAM.Config}}{{println .Subnet}}{{end}}' "$name" | sed '/^$/d' | LC_ALL=C sort)" \
    || die "network $name not found; production is untouched"
  [[ "$actual" == "$wanted" ]] || die "network $name has the subnets [${actual//$'\n'/ }], the new Compose files fix [${wanted//$'\n'/ }].
Compose does not change a running network. In a maintenance window, recreate it with the
running version (volumes are kept): ${COMPOSE[*]} down && ${COMPOSE[*]} up -d
then run the deploy again. Production is untouched."
}

stop_and_backup() {
  backup_dir_ready "$QWBE_IMAGE:$OLD_TAG" || die "production is untouched"
  PHASE=stopped
  APP_STOPPED=1
  say "stopping app ($QWBE_IMAGE:$OLD_TAG)"
  stop_app "deploy.sh ($QWBE_IMAGE:$OLD_TAG, deploying $NEW_TAG)" || die "could not stop app"
  backup_archive "$OLD_TAG" || die "no backup, no deploy: $NEW_TAG is not started"
  DEPLOY_BACKUP="$BACKUP_FILE"
  prune_backups
}

switch_to_new() {
  ENV_BEFORE="$(env_keep deploy)" || die "could not keep a copy of .env"
  env_set "IMAGE_TAG=$NEW_TAG" || die "could not write IMAGE_TAG to .env"
  PHASE=switched
  say "starting $QWBE_IMAGE:$NEW_TAG: migrate, then app (previous .env kept at $ENV_BEFORE)"
  start_stack "$NEW_TAG"
}

# none: this run's migrate did not run or reported `changed: 0`; changed; unknown.
migrate_outcome() {
  local container report image="$QWBE_IMAGE:$NEW_TAG"
  container="$(compose ps -a -q migrate 2>/dev/null || true)"
  [[ -n "$container" ]] || { echo none; return; }
  [[ "$(docker inspect -f '{{.State.StartedAt}}' "$container")" != 0001-01-01T00:00:00Z ]] || { echo none; return; }
  [[ "$(docker inspect -f '{{.State.Status}}' "$container")" == exited ]] || { echo unknown; return; }
  report="$(docker logs "$container" 2>/dev/null | tail -n 1)"
  if json_ok "$image" 'Number.isInteger(r.changed) && r.changed === 0' <<<"$report"; then echo none
  elif json_ok "$image" 'Number.isInteger(r.changed) && r.changed > 0' <<<"$report"; then echo changed
  else echo unknown; fi
}

# The previous image, under its own tag, is pinned again to the ID recorded at step 2.
pin_previous() { [[ "$OLD_TAG" == *@* ]] || docker tag "$ACTIVE_ID" "$QWBE_IMAGE:$OLD_TAG"; }

roll_back() {
  say "rolling back to $QWBE_IMAGE:$OLD_TAG: the schema is unchanged; writes $NEW_TAG made while it ran are kept"
  if pin_previous && env_set "IMAGE_TAG=$OLD_TAG" && start_stack "$OLD_TAG"; then
    say "rolled back to $OLD_TAG and ready; the deploy of $NEW_TAG FAILED"
  else
    local state="app is down"
    [[ -e "$APP_STOPPED_MARKER" ]] || state="app runs $OLD_TAG, but the stack is not ready (above)"
    warn "the rollback failed too; $state. .env before the deploy: $ENV_BEFORE; logs: docker compose logs migrate app"
  fi
}

require_restore() {
  local command="scripts/production/restore.sh $DEPLOY_BACKUP --apply"
  pin_previous || true
  printf '%s\n' "deploy of $NEW_TAG failed $(date -u +%FT%TZ), migrate outcome: $1" \
    "backup before it: $DEPLOY_BACKUP (made by $QWBE_IMAGE:$OLD_TAG, $ACTIVE_ID)" "restore: $command" > "$RECOVERY_MARKER"
  warn "the deploy of $NEW_TAG FAILED and the schema may have changed (migrate: $1).
The previous version is not started on this database, and app stays stopped.
Restore the backup taken before this deploy; restore.sh uses the image that made it ($QWBE_IMAGE:$OLD_TAG):
  $command"
}

recover() {
  PHASE=recovering
  local outcome
  # Anything but a clear `none` or `changed` (the check itself failing too) is unknown:
  # the safe path, a restore.
  outcome="$(migrate_outcome || echo unknown)"
  [[ "$outcome" == none || "$outcome" == changed ]] || outcome=unknown
  warn "$QWBE_IMAGE:$NEW_TAG did not become ready; migrate outcome: $outcome"
  # A `migrate` still running would go on changing the schema after the decision.
  compose stop migrate || true
  stop_app "deploy.sh (recovering from $QWBE_IMAGE:$NEW_TAG)" || true
  if [[ "$outcome" == none ]]; then roll_back; else require_restore "$outcome"; fi
}

# shellcheck disable=SC2329  # the EXIT trap
on_exit() {
  remove_partial
  case "$PHASE" in
    stopped) start_stopped_app || true ;;
    switched) recover ;;
  esac
}

prune_images() {
  local tag keep
  keep=" $NEW_TAG $OLD_TAG $(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'qwbe-invoicing-*.meta' \
    -exec sed -n 's/^image_tag=//p' {} + | tr '\n' ' ') "
  for tag in $(docker image ls "$QWBE_IMAGE" --format '{{.Tag}}' | grep -E '^[0-9a-f]{12}$' || true); do
    [[ "$keep" == *" $tag "* ]] && continue
    if docker image rm "$QWBE_IMAGE:$tag" >/dev/null; then say "removed image $QWBE_IMAGE:$tag"; else warn "kept image $QWBE_IMAGE:$tag (in use)"; fi
  done
}

main() {
  [[ $# -eq 0 ]] || die "usage: scripts/production/deploy.sh"
  preflight
  refuse_pending
  checkout_ready
  record_active
  pull_and_build
  network_ready
  trap on_exit EXIT
  trap 'exit 143' TERM
  trap 'exit 130' INT
  stop_and_backup
  if ! switch_to_new; then recover; exit 1; fi
  PHASE=finished
  prune_images
  say "deployed $QWBE_IMAGE:$NEW_TAG; backup before it: $DEPLOY_BACKUP"
}

main "$@"; exit $?
