#!/usr/bin/env bash
# Drill of scripts/production/ on an isolated stack, with data: install, the
# fail-closed guards, backup and retention, a deploy whose backup fails, a deploy from
# the checkout, restore dry-run and apply with the switch, a deploy whose app does not
# start (rollback) and one that also changes the schema (restore required, then done).
#
#   scripts/production/drill.sh          (DRILL_PORT, default 3198, must be free)
#
# Everything is its own: a temporary directory with a snapshot of this working tree as
# the `main` of a local upstream and a checkout of it (with .env, secrets and
# BACKUP_DIR), the Compose project `qwbe-drill`, the image repository `qwbe-drill` (so
# tagging and pruning never reach qwbe-invoicing:*), and volumes renamed `qwbe-drill-*`
# by an override. compose.prod.yaml names its volumes `qwbe-invoicing-*`, the
# development stack's on this host, so before every step the drill refuses to go on
# unless every volume of the project is `qwbe-drill-*`. At exit, success or not, it
# removes that project with its volumes, the `qwbe-drill-*` volumes made by restores,
# the `qwbe-drill` tags and the temporary directory. The checkout's own `.env` and
# `.local/` are never read or written.
#
# Exit: 0 every check passed, 1 a check failed, 2 refused to start.
set -euo pipefail
# shellcheck source=scripts/production/drill-support.sh
source "$(dirname "${BASH_SOURCE[0]}")/drill-support.sh"
# shellcheck source=scripts/production/drill-interrupts.sh
source "$(dirname "${BASH_SOURCE[0]}")/drill-interrupts.sh"

setup
install_with_data

# ---- Fail-closed guards ---------------------------------------------------------------
cp "$checkout/.env" "$work/env.good"
mkdir -p "$checkout/.local/production"
# One process, so killing it releases the lock (a `flock ... sleep` child would keep it).
bash -c 'exec 9>>"$1" && flock 9 && exec sleep 300' _ "$checkout/.local/production/lock" &
holder=$!
sleep 1
for script in deploy.sh backup.sh; do refused 'holds .*/lock' "$scripts/$script"; done
refused 'holds .*/lock' "$scripts/restore.sh" "$backups/qwbe-invoicing-20260101T000000Z.tar.gz"
kill "$holder"; wait "$holder" 2>/dev/null || true; holder=""
pass "lock held elsewhere: deploy, backup and restore refuse"

echo "local change" >> "$checkout/README.md"
refused 'local changes' "$scripts/deploy.sh"
git -C "$checkout" checkout -q -- README.md
touch "$checkout/untracked-file"
refused 'local changes' "$scripts/deploy.sh"
rm "$checkout/untracked-file"
git -C "$checkout" switch -q -c not-main
refused "on 'not-main', not main" "$scripts/deploy.sh"
git -C "$checkout" switch -q main
pass "dirty checkout (tracked or untracked) and a branch other than main: deploy refuses"

set_env BACKUP_KEEP 0
refused 'BACKUP_KEEP .* integer >= 1' "$scripts/backup.sh"
# shellcheck disable=SC2016  # a literal interpolation is the point
set_env BACKUP_KEEP '$(id)'
refused 'BACKUP_KEEP .* plain value' "$scripts/backup.sh"
cp "$work/env.good" "$checkout/.env"
sed -i '/^BACKUP_DIR=/d' "$checkout/.env"
refused 'BACKUP_DIR is not set' "$scripts/backup.sh"
cp "$work/env.good" "$checkout/.env"
set_env COMPOSE_FILE compose.loopback.yaml
refused 'must include compose.prod.yaml' "$scripts/backup.sh"
cp "$work/env.good" "$checkout/.env"
set_env QWBE_IMAGE 'Qwbe-Drill'
refused 'QWBE_IMAGE in .* is not valid' "$scripts/backup.sh"
set_env QWBE_IMAGE "$project"
set_env BACKUP_DIR "$backups:/elsewhere"
refused 'BACKUP_DIR in .* is not valid' "$scripts/backup.sh"
cp "$work/env.good" "$checkout/.env"
pass ".env: BACKUP_KEEP 0, an interpolation, a missing key, compose files without compose.prod.yaml, an invalid QWBE_IMAGE, BACKUP_DIR with ':': refused"

docker tag "$(docker inspect -f '{{.Image}}' "$("${compose[@]}" ps -q db)")" "$project:mismatch"
set_env IMAGE_TAG mismatch
refused 'but .env names' "$scripts/deploy.sh"
refused 'but .env names' "$scripts/backup.sh"
cp "$work/env.good" "$checkout/.env"
docker image rm "$project:mismatch" >/dev/null
pass "app runs another image than .env names: deploy and backup refuse"

chmod 500 "$backups"
refused 'BACKUP_DIR is not writable' "$scripts/backup.sh"
chmod 770 "$backups"
runs_image install || fail "app stopped by a refused backup"
pass "BACKUP_DIR not writable: backup refuses before app stops"

echo "drill marker" > "$checkout/.local/production/recovery-required"
refused 'needs a restore first' "$scripts/deploy.sh"
refused 'needs a restore first' "$scripts/backup.sh"
rm "$checkout/.local/production/recovery-required"
pass "a pending recovery: deploy and backup refuse"

# ---- Backup and retention -------------------------------------------------------------
ln -s /etc/hostname "$backups/qwbe-invoicing-20000101T000000Z.tar.gz"
touch "$backups/qwbe-invoicing-notes.txt"
for _ in 1 2 3 4; do succeeds "$scripts/backup.sh"; sleep 1; done
[[ "$(archives | wc -l)" == 3 ]] || fail "retention kept $(archives | wc -l) archives, BACKUP_KEEP=3"
[[ -L "$backups/qwbe-invoicing-20000101T000000Z.tar.gz" && -f "$backups/qwbe-invoicing-notes.txt" ]] || fail "retention touched foreign files"
for archive in $(archives); do [[ -f "${archive%.tar.gz}.meta" ]] || fail "no metadata for $archive"; done
meta="$(archives | tail -n 1)" meta="${meta%.tar.gz}.meta"
{ grep -q '^image_tag=install$' "$meta" && grep -q '^organization_id=drill-org$' "$meta"; } || fail "metadata: $(cat "$meta")"
! grep -qiE 'token|password|secret' "$meta" || fail "metadata names a secret: $(cat "$meta")"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/health/ready")" == 200 ]] || fail "app not back after backup"
[[ ! -e "$stopped_marker" ]] || fail "app-stopped left after a backup that finished"
pass "backup x4: archive + metadata, retention keeps 3 and only its own files, app back"
backup_interrupted_by_term
backup_killed

# ---- A deploy whose backup fails stops before the new version -------------------------
printf '\n<!-- drill v2 -->\n' >> "$author/README.md"
{ head -n 1 "$author/scripts/production/deploy.sh"; for _ in $(seq 1 60); do echo ": drill padding"; done
  tail -n +2 "$author/scripts/production/deploy.sh"; echo 'echo "drill: the new deploy.sh was read" >&2'; } > "$work/deploy.v2"
cat "$work/deploy.v2" > "$author/scripts/production/deploy.sh"
commit_upstream "drill: v2"
v2="$(git -C "$author" rev-parse HEAD | cut -c1-12)"
before="$(archives | wc -l)"
"${compose[@]}" exec -T app sh -c 'ln -s /etc/passwd /data/artifacts/drill-stray'
refused 'no backup, no deploy' "$scripts/deploy.sh"
"${compose[@]}" exec -T app rm /data/artifacts/drill-stray
[[ "$(env_value IMAGE_TAG)" == install ]] || fail "IMAGE_TAG changed by a deploy without backup"
runs_image install || fail "the previous app is not running again"
[[ "$(archives | wc -l)" == "$before" ]] || fail "a failed backup left an archive"
pass "deploy with a failing backup: refused, IMAGE_TAG unchanged, previous app running, no archive"

# ---- Deploy from the checkout ----------------------------------------------------------
succeeds "$scripts/deploy.sh"
! grep -q 'the new deploy.sh was read' "$log" || fail "bash read the deploy.sh that git pull wrote"
[[ "$(env_value IMAGE_TAG)" == "$v2" ]] || fail "IMAGE_TAG is $(env_value IMAGE_TAG), not $v2"
runs_image "$v2" || fail "app does not run $project:$v2"
docker image inspect "$project:install" >/dev/null || fail "the previous image was not kept"
doctor_ok || fail "doctor not ready"
login
[[ "$(pdf_status "$first_invoice")" == 200 ]] || fail "the invoice PDF did not survive the deploy"
deploy_backup="$(archives | tail -n 1)"
grep -q '^image_tag=install$' "${deploy_backup%.tar.gz}.meta" || fail "the deploy backup was not made by the previous image"
pass "deploy $v2 from the checkout: backup by the previous image, IMAGE_TAG pinned, doctor ready, data kept, self-update safe"

second_invoice="$(issue_invoice drill-2)"

# ---- Restore: refusals, dry-run, apply and switch --------------------------------------
mkdir "$work/tampered"
cp "$deploy_backup" "${deploy_backup%.tar.gz}.meta" "$work/tampered/"
tampered="$work/tampered/$(basename "$deploy_backup")"
sed -i 's/^image_id=.*/image_id=sha256:0000/' "${tampered%.tar.gz}.meta"
refused 'not that image on this host' "$scripts/restore.sh" "$tampered"
cp "${deploy_backup%.tar.gz}.meta" "$work/tampered/"
sed -i 's/^organization_id=.*/organization_id=other-org/' "${tampered%.tar.gz}.meta"
refused 'belongs to ORGANIZATION_ID other-org' "$scripts/restore.sh" "$tampered"
mkdir "$work/odd:dir"
cp "$deploy_backup" "${deploy_backup%.tar.gz}.meta" "$work/odd:dir/"
refused 'cannot be mounted' "$scripts/restore.sh" "$work/odd:dir/$(basename "$deploy_backup")"
databases() { "${compose[@]}" exec -T db psql -U qwbe -d postgres -tAc "SELECT string_agg(datname, ',' ORDER BY datname) FROM pg_database"; }
dbs_before="$(databases)" volumes_before="$(docker volume ls -q --filter "name=^$project-" | sort)"
refused 'not confirmed; nothing was changed' sh -c "echo wrong-name | '$scripts/restore.sh' '$deploy_backup' --apply"
succeeds "$scripts/restore.sh" "$deploy_backup"
{ grep -q 'dry-run ok' "$log" && grep -q 'removed the dry-run database' "$log"; } || fail "dry-run: $(tail -n 10 "$log")"
[[ "$(databases)" == "$dbs_before" && "$(docker volume ls -q --filter "name=^$project-" | sort)" == "$volumes_before" ]] \
  || fail "dry-run or a refused restore left a database or a volume"
[[ "$(env_value IMAGE_TAG)" == "$v2" ]] || fail "dry-run switched .env"
pass "restore refuses a foreign image, a foreign organization, a directory with ':' and a wrong confirmation; dry-run leaves nothing"
dry_run_interrupted "$deploy_backup"

succeeds sh -c "basename '$deploy_backup' | '$scripts/restore.sh' '$deploy_backup' --apply"
{ grep -q 'Everything after' "$log" && grep -q 'ANAF OAuth connection are not' "$log"; } || fail "the plan does not warn: $(head -n 20 "$log")"
target_db="$(env_value QWBE_PGDATABASE)"
[[ "$target_db" == qwbe_invoicing_r* && "$(env_value QWBE_DATA_VOLUME)" == "$project-data-r"* && "$(env_value IMAGE_TAG)" == install ]] \
  || fail "the switch: $(grep -E '^(QWBE_PGDATABASE|QWBE_DATA_VOLUME|IMAGE_TAG)=' "$checkout/.env")"
doctor_ok ".schemaDrift == [] and .database.database == \"$target_db\"" || fail "doctor after the switch"
{ docker volume inspect "$project-data" >/dev/null && [[ "$(databases)" == *qwbe_invoicing,* ]]; } || fail "the source was not kept"
login
[[ "$(pdf_status "$first_invoice")" == 200 ]] || fail "the restored invoice PDF"
[[ "$(api GET "/api/invoices/$second_invoice")" == 404 ]] || fail "an invoice made after the backup is present"
pass "restore --apply: new database + volume, switched with the backup's image, doctor ready, data of the backup only, source kept"
restore_switch_interrupted "$deploy_backup"

# ---- A deploy whose app does not start: rollback --------------------------------------
docker tag "$project:install" "$project:0123456789ab"
succeeds "$scripts/deploy.sh"
[[ "$(env_value IMAGE_TAG)" == "$v2" ]] || fail "deploy after the restore"
! docker image inspect "$project:0123456789ab" >/dev/null 2>&1 || fail "an image no backup names was not pruned"
docker image inspect "$project:install" >/dev/null || fail "pruned the image of kept backups"
pass "deploy after the restore; image retention: an unreferenced commit tag removed, the backups' images kept"
sed -i 's|^CMD \["node", "bin/qwbe-invoicing.ts", "serve"\]|CMD ["node", "-e", "process.exit(3)"]|' "$author/Dockerfile"
commit_upstream "drill: v3, app exits"
refused 'rolled back to '"$v2"' and ready; the deploy of [0-9a-f]{12} FAILED' "$scripts/deploy.sh"
grep -q 'migrate outcome: none' "$log" || fail "rollback reason: $(tail -n 10 "$log")"
{ [[ "$(env_value IMAGE_TAG)" == "$v2" ]] && runs_image "$v2"; } || fail "not back on $v2"
doctor_ok || fail "doctor after rollback"
pass "deploy with an app that does not start, schema unchanged: rolled back to $v2, ready, exit non-zero"

# ---- A deploy that changes the schema and fails: restore required ---------------------
jq '. + [{"name":"catalog-002-drill","statements":["CREATE TABLE drill_marker(id INT PRIMARY KEY)"]}]' \
  "$author/cubes/invoicing/catalog/contracts/migrations.json" > "$work/migrations.json"
cp "$work/migrations.json" "$author/cubes/invoicing/catalog/contracts/migrations.json"
commit_upstream "drill: v4, new migration, app exits"
refused 'schema may have changed \(migrate: changed\)' "$scripts/deploy.sh"
[[ -z "$("${compose[@]}" ps -q --status running app)" ]] || fail "app runs after a schema change"
marker="$checkout/.local/production/recovery-required"
[[ -f "$marker" ]] || fail "no recovery marker"
refused 'needs a restore first' "$scripts/backup.sh"
refused 'needs a restore first' "$scripts/deploy.sh"
restore_command="$(sed -n 's/^restore: //p' "$marker")"
archive="$(awk '{ print $2 }' <<<"$restore_command")"
succeeds sh -c "basename '$archive' | (cd '$checkout' && $restore_command)"
[[ ! -f "$marker" && "$(env_value IMAGE_TAG)" == "$v2" ]] || fail "after the printed restore: $(tail -n 10 "$log")"
doctor_ok || fail "doctor after the recovery"
pass "deploy that changed the schema: old version not started, restore command printed and run, ready on $v2"

echo "drill: all checks passed"
