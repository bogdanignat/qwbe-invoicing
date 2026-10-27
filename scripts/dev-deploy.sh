#!/usr/bin/env bash
# Development deploy (microq, Warden, compose.yaml): build, start, wait, doctor.
#
#   scripts/dev-deploy.sh
#
# `docker compose build`, `docker compose stop app`, `docker compose up -d` (it returns
# once `migrate` has exited and `app` is started), then waits for `app` to be healthy and for
# `doctor --json` to answer `ready: true`. No git pull and no backup: the development
# database can be recreated at will. When `migrate` refuses the database as drift (its
# schema is not the one its migration history explains), it says so and stops; on dev,
# recreating the database is one option and your decision: `docker compose down -v`
# deletes the cluster, the PDFs and the backup staging.
#
# Exit: 0 ready, 1 failed.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail() { echo "dev-deploy: FAIL $*" >&2; exit 1; }

docker compose build
# A running app holds the maintenance key SHARED, and `up` runs `migrate` before it
# recreates app: migrate would refuse. So app stops first (a few seconds of downtime).
docker compose stop app
if ! docker compose up -d; then
  if docker compose logs migrate 2>&1 | grep -q 'schema does not match the migration contract'; then
    fail "migrate refused the database as drift: its schema is not the one its migration history explains.
Inspect the objects named in: docker compose logs migrate. On dev you may instead recreate it
(deletes the cluster, PDFs and staging): docker compose down -v && scripts/dev-deploy.sh"
  fi
  fail "docker compose up: $(docker compose logs --tail=30 migrate app 2>&1)"
fi

container="$(docker compose ps -q app)"
for _ in $(seq 1 60); do
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "$container")" == healthy ]] && break
  sleep 3
done
[[ "$(docker inspect -f '{{.State.Health.Status}}' "$container")" == healthy ]] \
  || fail "app is not healthy: $(docker compose logs --tail=30 app 2>&1)"

report="$(docker compose exec -T app node bin/qwbe-invoicing.ts doctor --json)" || fail "doctor: $report"
grep -q '"ready":true' <<<"$report" || fail "doctor is not ready: $report"
echo "dev-deploy: ready ($(docker inspect -f '{{.Config.Image}}' "$container"))"
