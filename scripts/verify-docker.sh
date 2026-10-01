#!/usr/bin/env bash
# Run the repository's checks inside the pinned verifier container.
#
# Scope: lint, typecheck, tests, gates, the CLI and the probes — never the
# shipped image, never an application volume, never a published port.
#
# Side effects: builds the local image `qwbe-invoicing-verify`, creates the named
# volumes of the `qwbe-invoicing-verify` compose project (dependencies, frontend
# dependencies, pnpm store, HOME, the rig secret) plus the `qwbe-invoicing-test`
# project's own secret volume, starts a throwaway PostgreSQL 16 cluster on tmpfs in
# whichever rig is used, and writes build output into the bind-mounted working tree
# as the host user. No data is deleted, no port is published and no application
# volume is referenced.
#
# Exit codes: 0 success, 2 invalid usage, otherwise the exit code of the command
# that ran in the container.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${repository_root}/compose.verify.yaml"
# The test-only rig. Same image and same dependency volumes, its own PostgreSQL 16
# cluster and its own project, so the fast loop and the full gate never share a
# server lifetime.
test_compose_file="${repository_root}/compose.test.yaml"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"
export HOST_UID HOST_GID

usage() {
  cat <<'USAGE'
Usage: scripts/verify-docker.sh <command> [arguments]

Commands:
  build                 Build the verifier image (pinned Node 24.19.0 / pnpm 11.22.0).
  install [--no-frozen] Install dependencies into the named volumes. Frozen by default.
  verify                Run `pnpm verify` (the full gate) in the container, with a
                        throwaway PostgreSQL 16 cluster, because the suite needs one.
  test ["<command>"]    Run `pnpm test` (or the given command) in the test-only rig,
                        compose.test.yaml. Same image and dependency volumes, its own
                        cluster. This is the fast loop.
  run "<command>"       Run one quoted shell command in the verifier, same volumes.
  plan "<command>"      Print the docker command that would run; touches nothing.
  down                  Stop both rigs' containers. No volume is ever removed.
  help                  This text.

Environment:
  LOG=<path>            Also append combined output and the exit code to <path>.
  VERIFY_IMAGE_TAG      Image tag to build/run (default: local).

Safe example (read-only, no container state changes beyond the volumes):
  scripts/verify-docker.sh run "node --version && pnpm --version"
USAGE
}

compose_run() {
  docker compose --file "${compose_file}" run --rm verify "$1"
}

compose_test() {
  docker compose --file "${test_compose_file}" run --rm test "$1"
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
    if [[ "${1:-}" == "--no-frozen" ]]; then
      # Only ever for adding a dependency on purpose; every other run is frozen.
      log_wrap compose_run "pnpm install --no-frozen-lockfile"
    else
      log_wrap compose_run "pnpm install --frozen-lockfile"
    fi
    ;;
  verify)
    log_wrap compose_run "pnpm verify"
    ;;
  test)
    # No argument is the whole suite; one quoted argument is any command, run in
    # the same rig so it sees the same cluster and the same secret file.
    [[ $# -le 1 ]] || { echo "test takes at most one quoted command string" >&2; usage >&2; exit 2; }
    log_wrap compose_test "${1:-pnpm test}"
    ;;
  down)
    # Containers only. No `-v`: the dependency volumes and the pnpm store are the
    # expensive part and nothing in them is test state.
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
    ;;
  help | --help | -h)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
