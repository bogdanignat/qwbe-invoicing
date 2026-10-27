#!/usr/bin/env bash
# Drill of scripts/production/ on an isolated stack, with data: install, the
# fail-closed guards, backup that deletes nothing, a deploy whose backup fails, a deploy from
# the checkout, restore dry-run and apply with the switch, a deploy whose app does not
# start (rollback), one that also changes the schema (restore required, then done), and
# restore with the installed image (drill-restore.sh): an older archive migrated, a newer
# one refused, a migration that fails.
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
# shellcheck source=scripts/production/drill-restore.sh
source "$(dirname "${BASH_SOURCE[0]}")/drill-restore.sh"

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

# shellcheck disable=SC2016  # a literal interpolation is the point
set_env QWBE_IMAGE '$(id)'
refused 'QWBE_IMAGE .* plain value' "$scripts/backup.sh"
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
pass ".env: an interpolation, a missing key, compose files without compose.prod.yaml, an invalid QWBE_IMAGE, BACKUP_DIR with ':': refused"

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

# ---- Backup: no archive is ever deleted ----------------------------------------
ln -s /etc/hostname "$backups/qwbe-invoicing-20000101T000000Z.tar.gz"
touch "$backups/qwbe-invoicing-notes.txt"
before="$(archives | wc -l)"
for _ in 1 2 3 4; do succeeds "$scripts/backup.sh"; sleep 1; done
[[ "$(archives | wc -l)" == $((before + 4)) ]] || fail "$(archives | wc -l) archives after 4 backups, $before before"
[[ -L "$backups/qwbe-invoicing-20000101T000000Z.tar.gz" && -f "$backups/qwbe-invoicing-notes.txt" ]] || fail "a backup touched foreign files"
for archive in $(archives); do [[ -f "${archive%.tar.gz}.meta" ]] || fail "no metadata for $archive"; done
meta="$(archives | tail -n 1)" meta="${meta%.tar.gz}.meta"
{ grep -q '^image_tag=install$' "$meta" && grep -q '^organization_id=drill-org$' "$meta"; } || fail "metadata: $(cat "$meta")"
! grep -qiE 'token|password|secret' "$meta" || fail "metadata names a secret: $(cat "$meta")"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/health/ready")" == 200 ]] || fail "app not back after backup"
[[ ! -e "$stopped_marker" ]] || fail "app-stopped left after a backup that finished"
pass "backup x4: archive + metadata, none deleted, foreign files untouched, app back"
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

# ---- A network on other subnets than the Compose files fix: refused before app stops ---
subnet="$(env_value QWBE_NETWORK_SUBNET)"
set_env QWBE_NETWORK_SUBNET 10.93.3.0/24
refused 'has the subnets' "$scripts/deploy.sh"
set_env QWBE_NETWORK_SUBNET "$subnet"
[[ "$(env_value IMAGE_TAG)" == install ]] || fail "IMAGE_TAG changed by a deploy refused for its network"
runs_image install || fail "app stopped by a deploy refused for its network"
[[ "$(archives | wc -l)" == "$before" ]] || fail "a deploy refused for its network made a backup"
pass "network on other subnets: deploy refuses before app stops or a backup is made; the next deploy runs with them restored"

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
dbs_before="$(databases)" volumes_before="$(volumes)"
set_env ORGANIZATION_ID other-org
refused 'belongs to organization "drill-org", .env says ORGANIZATION_ID other-org; nothing was created' \
  "$scripts/restore.sh" "$deploy_backup"
set_env ORGANIZATION_ID drill-org
mkdir "$work/odd:dir"
cp "$deploy_backup" "$work/odd:dir/"
refused 'cannot be mounted' "$scripts/restore.sh" "$work/odd:dir/$(basename "$deploy_backup")"
refused 'not confirmed; nothing was changed' sh -c "echo wrong-name | '$scripts/restore.sh' '$deploy_backup' --apply"
# The .meta is for people only: an archive without it restores the same.
mkdir "$work/no-meta"
cp "$deploy_backup" "$work/no-meta/"
succeeds "$scripts/restore.sh" "$work/no-meta/$(basename "$deploy_backup")"
{ grep -q 'dry-run ok' "$log" && grep -q 'removed the dry-run database' "$log"; } || fail "dry-run: $(tail -n 10 "$log")"
[[ "$(databases)" == "$dbs_before" && "$(volumes)" == "$volumes_before" ]] \
  || fail "dry-run or a refused restore left a database or a volume"
[[ "$(env_value IMAGE_TAG)" == "$v2" ]] || fail "dry-run switched .env"
pass "restore refuses another organization (from the manifest), a directory with ':' and a wrong confirmation; dry-run without .meta leaves nothing"
dry_run_interrupted "$deploy_backup"

# The deploy's backup was made by $project:install; it is restored with the image installed now.
succeeds sh -c "basename '$deploy_backup' | '$scripts/restore.sh' '$deploy_backup' --apply"
{ grep -q 'Everything after' "$log" && grep -q 'ANAF OAuth connection are not' "$log"; } || fail "the plan does not warn: $(head -n 20 "$log")"
grep -q "migrated the target to $project:$v2 (0 applied)" "$log" || fail "migrate on the target: $(tail -n 10 "$log")"
target_db="$(env_value QWBE_PGDATABASE)"
[[ "$target_db" == qwbe_invoicing_r* && "$(env_value QWBE_DATA_VOLUME)" == "$project-data-r"* && "$(env_value IMAGE_TAG)" == "$v2" ]] \
  || fail "the switch: $(grep -E '^(QWBE_PGDATABASE|QWBE_DATA_VOLUME|IMAGE_TAG)=' "$checkout/.env")"
doctor_ok ".schemaDrift == [] and .database.database == \"$target_db\"" || fail "doctor after the switch"
{ docker volume inspect "$project-data" >/dev/null && [[ "$(databases)" == *qwbe_invoicing,* ]]; } || fail "the source was not kept"
login
[[ "$(pdf_status "$first_invoice")" == 200 ]] || fail "the restored invoice PDF"
[[ "$(api GET "/api/invoices/$second_invoice")" == 404 ]] || fail "an invoice made after the backup is present"
pass "restore --apply with the installed image: new database + volume, IMAGE_TAG unchanged, doctor ready, data of the backup only, source kept"
restore_switch_interrupted "$deploy_backup"

# ---- A deploy whose app does not start: rollback --------------------------------------
sed -i 's|^CMD \["node", "bin/qwbe-invoicing.ts", "serve"\]|CMD ["node", "-e", "process.exit(3)"]|' "$author/Dockerfile"
commit_upstream "drill: v3, app exits"
v3="$(git -C "$author" rev-parse HEAD | cut -c1-12)"
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
v4="$(git -C "$author" rev-parse HEAD | cut -c1-12)"
refused 'schema may have changed \(migrate: changed\)' "$scripts/deploy.sh"
grep -q "1\. \.env names it (done by this deploy): docker tag .* && sed -i .*IMAGE_TAG=$v2" "$log" \
  || fail "the deploy does not print the image step: $(tail -n 8 "$log")"
[[ -z "$("${compose[@]}" ps -q --status running app)" ]] || fail "app runs after a schema change"
[[ "$(env_value IMAGE_TAG)" == "$v2" ]] || fail "IMAGE_TAG not set back to $v2 before the restore"
marker="$checkout/.local/production/recovery-required"
{ [[ -f "$marker" ]] && grep -q "^image: .*IMAGE_TAG=$v2.* (done by this deploy)$" "$marker"; } || fail "recovery marker: $(cat "$marker")"
refused 'needs a restore first' "$scripts/backup.sh"
refused 'needs a restore first' "$scripts/deploy.sh"
restore_command="$(sed -n 's/^restore: //p' "$marker")"
archive="$(awk '{ print $2 }' <<<"$restore_command")"
restore_waits_for_step_one "$archive"
succeeds sh -c "basename '$archive' | (cd '$checkout' && $restore_command)"
[[ ! -f "$marker" && "$(env_value IMAGE_TAG)" == "$v2" ]] || fail "after the printed restore: $(tail -n 10 "$log")"
doctor_ok || fail "doctor after the recovery"
pass "deploy that changed the schema: old version not started, .env back on $v2 with nothing started, restore printed and run, ready on $v2"

# ---- Restore with the installed image: older archive, newer archive, failing migration --
deploy_new_migration
restore_older_archive "$older"
restore_newer_refused
restore_migrate_fails

echo "drill: all checks passed"
