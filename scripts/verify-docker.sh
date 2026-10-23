#!/usr/bin/env bash
# Run the repository's checks inside the pinned verifier container.
#
# Scope: lint, typecheck, tests, gates, the CLI and the probes — never the
# shipped image, never an application volume, never a published port.
#
# Side effects: builds the local image `qwbe-invoicing-verify`, creates the named
# volumes of the `qwbe-invoicing-verify` compose project (dependencies, frontend
# dependencies, pnpm store, HOME) and writes build output into the bind-mounted
# working tree as the host user. The tests run on the project's own PostgreSQL
# (`db` of compose.yaml in the main checkout): it is started when it is down and
# never stopped. Each run creates its databases as `qwbe_t_<run>_…`; before and
# after a run the test databases of every run without a live container are
# dropped. Nothing else is deleted, no port is published and no application volume
# is referenced.
#
# Exit codes: 0 success, 2 invalid usage, otherwise the exit code of the command
# that ran in the container.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${repository_root}/compose.verify.yaml"
# The test-only rig. Same image, same dependency volumes and the same cluster, its
# own compose project.
test_compose_file="${repository_root}/compose.test.yaml"
# The main checkout: a worktree has no `.local/`, the project's secrets live there.
main_checkout="$(dirname "$(git -C "${repository_root}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null \
  || echo "${repository_root}/.git")")"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"
QWBE_PG_PASSWORD_FILE="${main_checkout}/.local/pg-password"
# This invocation's id: the prefix of its test databases and the label of its container.
QWBE_TEST_RUN="$(od -An -tx1 -N4 /dev/urandom | tr -d ' \n')"
export HOST_UID HOST_GID QWBE_PG_PASSWORD_FILE QWBE_TEST_RUN

usage() {
  cat <<'USAGE'
Usage: scripts/verify-docker.sh <command> [arguments]

Commands:
  build                 Build the verifier image (pinned Node 24.19.0 / pnpm 11.22.0).
  install [--no-frozen] Install dependencies into the named volumes. Frozen by default.
  verify                Run `pnpm verify` (the full gate) in the container, on the
                        project's PostgreSQL (started if it is down).
  test ["<command>"]    Run `pnpm test` (or the given command) in the test-only rig,
                        compose.test.yaml. Same image, volumes and cluster. The fast loop.
  run "<command>"       Run one quoted shell command in the verifier, same volumes.
  plan "<command>"      Print the docker command that would run; touches nothing.
  down                  Stop both rigs' containers. Never the project's db, never a volume.
  help                  This text.

Environment:
  LOG=<path>            Also append combined output and the exit code to <path>.
  VERIFY_IMAGE_TAG      Image tag to build/run (default: local).

Safe example (read-only, no container state changes beyond the volumes):
  scripts/verify-docker.sh run "node --version && pnpm --version"
USAGE
}

# The project's own stack, as the main checkout runs it. Name and file are pinned so
# a COMPOSE_PROJECT_NAME or COMPOSE_FILE of the caller's shell cannot redirect it.
project_db() {
  docker compose --project-directory "${main_checkout}" --project-name qwbe-invoicing \
    --file "${main_checkout}/compose.yaml" "$@"
}

project_psql() {
  project_db exec -T db psql -U qwbe -d postgres -v ON_ERROR_STOP=1 -At -c "$1" </dev/null
}

# Starts `db` when it is down and waits until it is healthy. A running `db` is only
# waited for, never recreated or stopped: the application may be using it.
ensure_project_db() {
  [[ -f "${QWBE_PG_PASSWORD_FILE}" ]] \
    || { echo "missing ${QWBE_PG_PASSWORD_FILE}: run scripts/init-secrets.sh in ${main_checkout}" >&2; return 1; }
  local id
  id="$(project_db ps --quiet --status running db)" || return
  if [[ -z "${id}" ]]; then
    project_db up --detach --wait db
    return
  fi
  for _ in $(seq 60); do
    [[ "$(docker inspect --format '{{.State.Health.Status}}' "${id}")" == healthy ]] && return 0
    sleep 2
  done
  echo "the project's db is running but not healthy" >&2
  return 1
}

# Drops the test databases (`qwbe_t_<run>_…`) of every run that has no live
# container. A concurrent run in another worktree keeps its container, so its
# databases survive; this run's own are dropped once its container has exited.
reclaim_test_databases() {
  local live names name run
  # The pattern is the whole guard: only `[a-z0-9_]` names, so each is safe to splice.
  names="$(project_psql "SELECT datname FROM pg_database WHERE datname ~ '^qwbe_t_[a-z0-9]+_[a-z0-9_]+\$'")" || return
  # Read after the names: a run creates databases only once its container runs, so
  # every name listed above whose run started meanwhile is still found live here.
  live=" $(docker ps --filter label=qwbe.test-run --format '{{.Label "qwbe.test-run"}}' | tr '\n' ' ') " || return
  for name in ${names}; do
    run="${name#qwbe_t_}"
    run="${run%%_*}"
    [[ "${live}" == *" ${run} "* ]] && continue
    project_psql "DROP DATABASE IF EXISTS ${name} WITH (FORCE)" >/dev/null || return
  done
}

# One containerised command on the project's cluster, with the leftovers of dead
# runs dropped before and this run's own dropped after, whatever its status.
# Explicit `|| return`: under `log_wrap` this runs inside an `if`, where `set -e` is off.
on_project_db() {
  ensure_project_db || return
  reclaim_test_databases || return
  local status=0
  "$@" || status=$?
  reclaim_test_databases || status=$((status == 0 ? 1 : status))
  return "${status}"
}

compose_run() {
  on_project_db docker compose --file "${compose_file}" run --rm verify "$1"
}

compose_test() {
  on_project_db docker compose --file "${test_compose_file}" run --rm test "$1"
}

log_wrap() {
  if [[ -z "${LOG:-}" ]]; then
    "$@"
    return $?
  fi
  mkdir -p "$(dirname "${LOG}")"
  # git is a convenience here, not a requirement: an exported tree still logs.
  local head
  head="$(git -C "${repository_root}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  local header="=== $(date -u +%Y-%m-%dT%H:%M:%SZ) :: $* (HEAD ${head})"
  # `|| true` here too, so a log that cannot be written becomes the status the
  # branch below reports instead of an errexit abort halfway through the header.
  echo "${header}" | tee -a "${LOG}" || true
  # The command heads the pipeline so its own status survives `tee`, and the
  # pipeline is the condition of an `if`: `set -e` does not apply to a condition,
  # so a failed run reaches the marker below instead of abandoning the function
  # at the first non-zero status. Without that, every failed log ended abruptly
  # and read as a truncated file to anything that parses it, while a passing run
  # was the only one that ever got `=== exit code: 0`.
  local status command_status tee_status
  if "$@" 2>&1 | tee -a "${LOG}"; then
    status=0
  else
    # Copied in ONE command: every command resets PIPESTATUS, so reading
    # `${PIPESTATUS[0]}` into a variable already destroys `${PIPESTATUS[1]}`
    # (`unbound variable` under `set -u`, which is how this was caught).
    local -a statuses=("${PIPESTATUS[@]}")
    command_status="${statuses[0]:-1}"
    tee_status="${statuses[1]:-0}"
    status="${command_status}"
    # A `tee` that failed is a failure of this wrapper even when the command
    # succeeded: the log on disk is incomplete, and returning 0 would hand back
    # a status the log cannot support.
    if [[ ${status} -eq 0 ]]; then
      status=1
      # Straight to stderr: the one message about a log that cannot be written
      # must not be sent through the writer that just failed.
      echo "=== log write failed (tee exit ${tee_status}); ${LOG} is incomplete" >&2
    fi
  fi
  # `|| true` on the writes only: a broken log must not swallow the status.
  echo "=== exit code: ${status}" | tee -a "${LOG}" || true
  return "${status}"
}

command_name="${1:-}"
[[ $# -gt 0 ]] && shift || true

case "${command_name}" in
  build)
    log_wrap docker compose --file "${compose_file}" build "$@"
    ;;
  install)
    # No database: the network-free `install` service, and the project's db is left alone.
    lockfile="--frozen-lockfile"
    # Only ever for adding a dependency on purpose; every other run is frozen.
    [[ "${1:-}" != "--no-frozen" ]] || lockfile="--no-frozen-lockfile"
    log_wrap docker compose --file "${compose_file}" run --rm install "pnpm install ${lockfile}"
    ;;
  verify)
    log_wrap compose_run "pnpm verify"
    ;;
  test)
    # No argument is the whole suite; one quoted argument is any command, run in
    # the same rig so it sees the same cluster and the same secret.
    [[ $# -le 1 ]] || { echo "test takes at most one quoted command string" >&2; usage >&2; exit 2; }
    log_wrap compose_test "${1:-pnpm test}"
    ;;
  down)
    # The rigs' containers only. No `-v`: the dependency volumes and the pnpm store
    # are the expensive part and nothing in them is test state. The project's `db`
    # belongs to another compose project and is never stopped here.
    # Both rigs are brought down even if the first refuses, and the first failure
    # is the status reported: under `set -e` a failing first `down` used to abort
    # the branch and leave the verify rig's containers running.
    down_status=0
    verify_status=0
    log_wrap docker compose --file "${test_compose_file}" down || down_status=$?
    log_wrap docker compose --file "${compose_file}" down || verify_status=$?
    [[ ${down_status} -ne 0 ]] || down_status=${verify_status}
    [[ ${down_status} -eq 0 ]] || exit "${down_status}"
    ;;
  run)
    # Exactly one argument: the container receives it as a single shell string,
    # so joining several would silently drop the caller's quoting.
    [[ $# -eq 1 ]] || { echo "run takes exactly one quoted command string" >&2; usage >&2; exit 2; }
    log_wrap compose_run "$1"
    ;;
  plan)
    [[ $# -eq 1 ]] || { echo "plan takes exactly one quoted command string" >&2; usage >&2; exit 2; }
    echo "docker compose --file ${compose_file} run --rm verify '$1'"
    echo "docker compose --file ${test_compose_file} run --rm test '$1'   # scripts/verify-docker.sh test"
    echo "user ${HOST_UID}:${HOST_GID}; bind ${repository_root} -> /app; volumes: verify-node-modules, verify-frontend-node-modules, verify-pnpm-store, verify-home"
    echo "postgres: db of ${main_checkout}/compose.yaml (qwbe-invoicing_default); test databases qwbe_t_${QWBE_TEST_RUN}_*"
    ;;
  help | --help | -h)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
