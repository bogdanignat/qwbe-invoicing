# shellcheck shell=bash
# Shared by deploy.sh, backup.sh and restore.sh, nothing else: messages, the host
# lock, the restrictive `.env` reader/writer and the active Compose configuration.
#
# The installation is the directory two levels up (the checkout, or a release bundle
# with the same layout). Its `.env` is the one source of configuration: every key it
# defines is removed from the calling environment first, because Compose prefers the
# environment to the file and a stray `export IMAGE_TAG=...` in an operator's shell
# would silently start another version.

QWBE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$QWBE_ROOT/.env"
STATE_DIR="$QWBE_ROOT/.local/production"
RECOVERY_MARKER="$STATE_DIR/recovery-required"
APP_STOPPED_MARKER="$STATE_DIR/app-stopped"
umask 077
# A `die` inside "$(...)" ends the caller too.
shopt -s inherit_errexit

# Messages go to the script's own stdout/stderr (fd 3 and 4): a trap can run while a
# function's output is redirected (`f >/dev/null`), and its report must still be seen.
exec 3>&1 4>&2
say() { printf '%s %s\n' "$(date '+%F %T')" "$*" >&3; }
warn() { printf '%s WARNING %s\n' "$(date '+%F %T')" "$*" >&4; }
die() { printf '%s ERROR %s\n' "$(date '+%F %T')" "$*" >&4; exit 1; }
stamp() { date -u +%Y%m%dT%H%M%SZ; }

# The last `KEY=value` line wins, as in Compose. Only a plain value is accepted:
# interpolation, escapes, inner quotes, comments or spaces are refused rather than
# guessed (the same rule as scripts/init-secrets.sh). Absent prints nothing.
env_get() {
  local line value
  line="$(grep -E "^[[:space:]]*$1=" "$ENV_FILE" | tail -n 1 || true)"
  value="${line#*=}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  case "$value" in
    *[\$\"\'\\\#[:space:]]*) die "$1 in $ENV_FILE must be a plain value (no \$, quotes, spaces or comments)" ;;
  esac
  printf '%s' "$value"
}

env_require() {
  local value
  value="$(env_get "$1")"
  [[ -n "$value" ]] || die "$1 is not set in $ENV_FILE"
  [[ -z "${2:-}" || "$value" =~ $2 ]] || die "$1 in $ENV_FILE is not valid: $value"
  printf '%s' "$value"
}

# Replaces each `KEY=` line in place (appends the missing ones), then renames
# atomically: a reader sees the old file or the new one, never half of it.
env_set() {
  local tmp
  tmp="$(mktemp "$ENV_FILE.XXXXXX")" || return 1
  awk -v set="$(printf '%s\n' "$@")" '
    BEGIN { n = split(set, pairs, "\n")
      for (i = 1; i <= n; i++) if (pairs[i] != "") value[substr(pairs[i], 1, index(pairs[i], "=") - 1)] = pairs[i] }
    { line = $0; sub(/^[[:space:]]+/, "", line); key = substr(line, 1, index(line, "=") - 1) }
    index(line, "=") > 1 && (key in value) { print value[key]; written[key] = 1; next }
    { print }
    END { for (key in value) if (!(key in written)) print value[key] }' "$ENV_FILE" > "$tmp" \
    && chmod "$(stat -c %a "$ENV_FILE")" "$tmp" && mv -f "$tmp" "$ENV_FILE" && return
  rm -f "$tmp"
  return 1
}

# The previous configuration, kept before every change of `.env`.
env_keep() {
  local copy
  copy="$STATE_DIR/env.$(stamp).$1"
  cp -p "$ENV_FILE" "$copy" || return 1
  printf '%s' "$copy"
}

# Sets the values the scripts read: QWBE_IMAGE, IMAGE_TAG, ORGANIZATION_ID,
# PGDATABASE_ACTIVE, DATA_VOLUME_ACTIVE, BACKUP_DIR, BACKUP_KEEP.
# shellcheck disable=SC2034
load_env() {
  [[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || die "no regular file at $ENV_FILE (copy .env.example first)"
  local key
  while read -r key; do
    case "$key" in PATH | HOME | USER | SHELL | TMPDIR) ;; *) unset "$key" ;; esac
  done < <(sed -nE 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' "$ENV_FILE")
  unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_NAME IMAGE_TAG QWBE_IMAGE
  QWBE_IMAGE="$(env_get QWBE_IMAGE)"
  QWBE_IMAGE="${QWBE_IMAGE:-ghcr.io/bogdanignat/qwbe-invoicing}"
  [[ "$QWBE_IMAGE" =~ ^[a-z0-9][a-z0-9._/-]*$ ]] || die "QWBE_IMAGE in $ENV_FILE is not valid: $QWBE_IMAGE"
  IMAGE_TAG="$(env_require IMAGE_TAG '^[A-Za-z0-9_.@:-]+$')"
  ORGANIZATION_ID="$(env_require ORGANIZATION_ID '^[A-Za-z0-9_.-]+$')"
  PGDATABASE_ACTIVE="$(env_require QWBE_PGDATABASE '^[a-z_][a-z0-9_]{0,62}$')"
  DATA_VOLUME_ACTIVE="$(env_require QWBE_DATA_VOLUME '^[A-Za-z0-9][A-Za-z0-9_.-]*$')"
  # No `:` or `,`: the directory is mounted with `-v "$BACKUP_DIR:/backup"`.
  BACKUP_DIR="$(env_require BACKUP_DIR '^/[^:,]*$')"
  BACKUP_KEEP="$(env_get BACKUP_KEEP)"
  BACKUP_KEEP="${BACKUP_KEEP:-14}"
  [[ "$BACKUP_KEEP" =~ ^[1-9][0-9]*$ ]] || die "BACKUP_KEEP in $ENV_FILE must be an integer >= 1, not '$BACKUP_KEEP'"
}

# The files Compose would use: COMPOSE_FILE from `.env`, or compose.prod.yaml. Always
# passed with -f, because without it Compose picks the checkout's development compose.yaml.
compose_init() {
  local files file found=0
  local -a list
  files="$(env_get COMPOSE_FILE)"
  IFS=: read -r -a list <<<"${files:-compose.prod.yaml}"
  COMPOSE=(docker compose --project-directory "$QWBE_ROOT" --env-file "$ENV_FILE")
  for file in "${list[@]}"; do
    [[ "$file" == /* ]] || file="$QWBE_ROOT/${file#./}"
    [[ -f "$file" ]] || die "compose file not found: $file"
    [[ "$file" == "$QWBE_ROOT/compose.prod.yaml" ]] && found=1
    [[ "$(basename "$file")" != compose.yaml ]] || die "compose.yaml is the development stack; COMPOSE_FILE must name compose.prod.yaml"
    COMPOSE+=(-f "$file")
  done
  [[ "$found" == 1 ]] || die "COMPOSE_FILE in $ENV_FILE must include compose.prod.yaml"
}

compose() { "${COMPOSE[@]}" "$@"; }
# The same configuration with another image tag, for one command only.
compose_tag() { IMAGE_TAG="$1" "${COMPOSE[@]}" "${@:2}"; }

# Held until the process exits, by deploy, backup and restore alike: the timer cannot
# stop `app` in the middle of a deploy, nor a restore switch the database under one.
take_lock() {
  { mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR"; } || die "cannot create $STATE_DIR"
  exec 9>>"$STATE_DIR/lock"
  flock -n 9 || die "another production operation (deploy, backup or restore) holds $STATE_DIR/lock"
}

preflight() {
  { command -v docker >/dev/null && docker info >/dev/null 2>&1; } || die "docker is not available"
  command -v flock >/dev/null || die "flock is not available"
  load_env
  compose_init
  take_lock
}

# deploy.sh and backup.sh refuse while a failed deploy waits for a restore, or while
# `app` is down because an operation was cut short (SIGKILL, power loss, the unit's
# stop timeout): what that operation changed is not known here, so starting `app`
# again is the operator's decision, not this script's.
refuse_pending() {
  [[ ! -e "$RECOVERY_MARKER" ]] || die "a failed deploy needs a restore first:
$(cat "$RECOVERY_MARKER")
Remove $RECOVERY_MARKER only once the installation is consistent again."
  [[ ! -e "$APP_STOPPED_MARKER" ]] || die "app was stopped by an operation that did not finish:
$(cat "$APP_STOPPED_MARKER")
Check it (docker compose ps, logs migrate app), start the stack (${COMPOSE[*]} up -d),
then remove $APP_STOPPED_MARKER."
}

# The marker is written before `app` stops and removed once it was started again, so a
# run that never reached its own restart leaves it behind for the next one.
stop_app() {
  printf '%s\n' "$1 stopped app at $(date -u +%FT%TZ) (pid $$)" > "$APP_STOPPED_MARKER" || return 1
  compose stop app
}
app_started() { rm -f "$APP_STOPPED_MARKER"; }

image_id() { docker image inspect -f '{{.Id}}' "$1" 2>/dev/null; }

# The image of the running `app` container (its ID), or nothing.
running_app_image() {
  local container
  container="$(compose ps -q --status running app 2>/dev/null)"
  [[ -n "$container" ]] && docker inspect -f '{{.Image}}' "$container"
}

# Evaluates a JavaScript condition on the JSON read from stdin (`r`), with the node of
# the given image: no host dependency, no network, no mount.
json_ok() {
  docker run --rm -i --network none --entrypoint node "$1" \
    -e "const r = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); process.exit(($2) ? 0 : 1)"
}

# Healthy within the timeout; a crash (a restart, or the container gone) fails at once.
wait_app_healthy() {
  local deadline=$((SECONDS + $1)) container state
  while ((SECONDS < deadline)); do
    container="$(compose ps -q app 2>/dev/null)"
    [[ -n "$container" ]] || return 1
    state="$(docker inspect -f '{{.State.Status}} {{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")" || return 1
    case "$state" in
      "running 0 healthy") return 0 ;;
      "running 0 "*) sleep 3 ;;
      *) return 1 ;;
    esac
  done
  return 1
}

# `doctor --json` in the running `app`: ready, plus an optional extra condition.
doctor_ready() {
  local report
  report="$(timeout 120 "${COMPOSE[@]}" exec -T app node bin/qwbe-invoicing.ts doctor --json)" || return 1
  json_ok "$1" "r.ready === true && (${2:-true})" <<<"$report"
}

# Starts what `.env` names: this run's `migrate` (an earlier exited one is removed, so
# the outcome read afterwards is this one's), then `app`, then the rest (Caddy) with
# --no-deps: a plain `up` would start the exited `migrate` again, which refuses while
# `app` holds the maintenance key. Ready means healthy, `doctor` ready (plus an
# optional condition) and every service up. app-stopped goes once `app` is healthy:
# from then on it runs, whatever fails after it.
start_stack() {
  local -a rest
  compose rm -f -s migrate >/dev/null 2>&1 || true
  timeout 900 "${COMPOSE[@]}" up -d --pull never migrate app || return 1
  wait_app_healthy 300 || return 1
  app_started
  doctor_ready "$QWBE_IMAGE:$1" "${2:-true}" || { warn "app is healthy, but doctor --json is not ready"; return 1; }
  mapfile -t rest < <(compose config --services | grep -vxE 'db|migrate|app' || true)
  ((${#rest[@]} == 0)) || compose up -d --pull never --no-deps "${rest[@]}" \
    || { warn "app is ready, but ${rest[*]} did not start: docker compose logs ${rest[*]}"; return 1; }
}
