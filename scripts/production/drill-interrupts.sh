# shellcheck shell=bash disable=SC2154  # the drill's names (work, checkout, compose...): drill-support.sh
# The interruptions of scripts/production/drill.sh: a signal while a backup holds `app`
# stopped, and while restore --apply switches `.env`. Sourced after drill-support.sh.
#
# Not drilled, because they cannot be timed or reproduced here:
# - systemd's own SIGKILL to the unit's whole cgroup at TimeoutStopSec. backup_killed
#   kills the script's bash only, which leaves the same state (no trap runs, app stays
#   stopped, app-stopped stays); the `docker compose run` it started lives on until the
#   CLI ends, as it would outside the cgroup (the container belongs to dockerd).
# - restore interrupted between `app` stopping and `.env` being written (the
#   "NOT switched" report): that window is two short commands long.
# - a `migrate` still running when deploy's recovery starts (deploy.sh stops it first).

stopped_marker="$checkout/.local/production/app-stopped"

# The `docker compose run` of a backup or restore is up.
one_off_running() { [[ -n "$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.oneoff=True)" ]]; }
partials() { find "$backups" -maxdepth 1 -name '.partial-*' -printf '%f\n'; }

# A production script in the background (stdin from $input), sent SIGNAL once
# CONDITION holds; its exit status in $status, its output in $log.
input=/dev/null
interrupt() {
  local signal="$1" condition="$2" pid
  shift 2
  isolated
  log="$work/log.$((step += 1))"
  "$@" <"$input" >"$log" 2>&1 &
  pid=$!
  for _ in $(seq 1 600); do "$condition" && break; sleep 0.2; done
  "$condition" || fail "$* never reached the point to interrupt: $(tail -n 20 "$log")"
  kill "-$signal" "$pid"
  status=0
  wait "$pid" || status=$?
}

# Holds once `.env` names another database than the one restored by drill.sh.
env_switched() { [[ "$(env_value QWBE_PGDATABASE)" != "$restored" ]]; }

remove_partials() {
  local partial
  for partial in $(partials); do rm -f -- "$backups/$partial"; done
}

# TERM while the CLI's backup runs: bash ends that command first, then the trap exits
# 143, removes the partial archive and starts `app` again.
backup_interrupted_by_term() {
  local before
  before="$(archives)"
  interrupt TERM one_off_running "$scripts/backup.sh"
  [[ "$status" == 143 ]] || fail "TERM during the backup exited $status: $(tail -n 15 "$log")"
  [[ -z "$(partials)" && "$(archives)" == "$before" ]] || fail "TERM left a partial or a new archive: $(partials)"
  { [[ ! -e "$stopped_marker" ]] && runs_image install; } || fail "app not started again after TERM: $(tail -n 15 "$log")"
  wait_ready
  pass "TERM during the backup: exit 143 once the CLI run ended, .partial-* removed, app started again, no app-stopped"
}

# SIGKILL (the unit's last resort): nothing of the script runs any more. The orphaned
# `docker compose run` keeps the lock (fd 9) until it ends; then the next run refuses.
backup_killed() {
  interrupt KILL one_off_running "$scripts/backup.sh"
  for _ in $(seq 1 300); do flock -n "$checkout/.local/production/lock" true && ! one_off_running && break; sleep 1; done
  flock -n "$checkout/.local/production/lock" true || fail "the lock is still held after the killed backup"
  [[ -f "$stopped_marker" && -z "$("${compose[@]}" ps -q --status running app)" ]] \
    || fail "after SIGKILL: app-stopped missing or app running"
  refused 'stopped by an operation that did not finish' "$scripts/backup.sh"
  refused 'stopped by an operation that did not finish' "$scripts/deploy.sh"
  # What the refusal tells the operator; the partial is theirs to remove (no trap ran).
  remove_partials
  "${compose[@]}" up -d >/dev/null 2>&1 || fail "starting the stack after SIGKILL"
  wait_ready
  rm "$stopped_marker"
  pass "SIGKILL during the backup: app stays stopped, app-stopped left, backup and deploy refuse until the operator starts the stack"
}

# TERM while the dry-run's CLI runs: its EXIT trap still drops the empty database.
dry_run_interrupted() {
  local before
  before="$(databases)"
  interrupt TERM one_off_running "$scripts/restore.sh" "$1"
  [[ "$status" == 143 ]] || fail "TERM during the dry-run exited $status: $(tail -n 15 "$log")"
  { grep -q 'removed the dry-run database' "$log" && [[ "$(databases)" == "$before" ]]; } \
    || fail "TERM during the dry-run left its database: $(tail -n 10 "$log")"
  pass "TERM during the restore dry-run: exit 143, its empty database removed"
}

# TERM once `.env` names the new target: exit 143, the state, the previous `.env` and
# the commands are printed, nothing more is started; the operator goes on as printed.
restore_switch_interrupted() {
  local archive="$1"
  restored="$(env_value QWBE_PGDATABASE)"
  basename "$archive" > "$work/answer"
  input="$work/answer"
  interrupt TERM env_switched "$scripts/restore.sh" "$archive" --apply
  input=/dev/null
  [[ "$status" == 143 ]] || fail "TERM during the switch exited $status: $(tail -n 15 "$log")"
  { grep -q '\.env IS switched to' "$log" && grep -q 'Previous \.env: .*/env\..*\.restore$' "$log" \
    && grep -q 'Nothing more is started' "$log"; } || fail "the interrupted switch does not say where it stands: $(tail -n 12 "$log")"
  [[ -f "$stopped_marker" ]] || fail "no app-stopped after an interrupted switch"
  refused 'stopped by an operation that did not finish' "$scripts/deploy.sh"
  { "${compose[@]}" stop app && "${compose[@]}" up -d; } >/dev/null 2>&1 || fail "going on as printed"
  wait_ready
  rm "$stopped_marker"
  doctor_ok ".database.database == \"$(env_value QWBE_PGDATABASE)\"" || fail "doctor on the target of the interrupted switch"
  pass "TERM during restore --apply after .env switched: exit 143, prints the state, the previous .env and the commands, starts nothing more"
}
