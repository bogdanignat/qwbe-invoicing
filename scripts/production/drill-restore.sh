# shellcheck shell=bash disable=SC2154  # the drill's names (work, checkout, v2...): drill-support.sh, drill.sh
# Restore with the image installed now, whatever image made the archive: the end of
# scripts/production/drill.sh, sourced after drill-support.sh. A deploy brings a new
# migration (catalog-002-drill, from drill.sh's v4); then an archive made before it is
# restored and migrated, one made after it is refused by the older image, and a
# migration that fails on the restored target leaves the source and `.env` as they were.
#
# Gaps in a history and a manifest that differs from the restored ledger are covered by
# the TypeScript tests (kernel/ops/postgres-backup-inspect.test.ts and the restore tests).

# The archive's name typed as the confirmation, as the operator does.
confirmed() { printf "basename '%s' | '%s' '%s' --apply" "$1" "$scripts/restore.sh" "$1"; }

# A failed deploy whose .env step failed: .env still names the failed version. The
# restore refuses before anything is made, printing step 1 of the marker; once that
# step is run as printed, the restore goes on (drill.sh runs it next).
restore_waits_for_step_one() {
  local archive="$1" dbs vols step_one
  dbs="$(databases)" vols="$(volumes)"
  set_env IMAGE_TAG "$v4"
  sed -i 's/ (done by this deploy)$/ (FAILED here: run it first)/' "$marker"
  step_one="$(sed -n 's/^image: \(.*\) (FAILED here: run it first)$/\1/p' "$marker")"
  [[ -n "$step_one" ]] || fail "no step 1 in the marker: $(cat "$marker")"
  refused "a failed deploy waits for a restore with $project:$v2 \(" sh -c "$(confirmed "$archive")"
  grep -qF "  $step_one" "$log" || fail "the refusal does not print step 1: $(tail -n 6 "$log")"
  { [[ "$(databases)" == "$dbs" && "$(volumes)" == "$vols" ]] && [[ -z "$("${compose[@]}" ps -q --status running app)" ]]; } \
    || fail "the refused restore created something or started app"
  (cd "$checkout" && sh -c "$step_one") || fail "step 1 as printed: $step_one"
  [[ "$(env_value IMAGE_TAG)" == "$v2" ]] || fail "step 1 did not set IMAGE_TAG back to $v2"
  pass "recovery with .env still on the failed $v4: restore refused, nothing created, step 1 printed; run as printed, .env names $v2"
}

# v5: v4's migration with an app that starts. Sets `older`, the deploy's backup, made
# by v2 before the migration. Only v5 and the previous v2 stay as commit images.
# shellcheck disable=SC2034  # `older` is read by drill.sh
deploy_new_migration() {
  local before tag
  docker tag "$project:install" "$project:0123456789ab"
  sed -i 's|^CMD \["node", "-e", "process.exit(3)"\]|CMD ["node", "bin/qwbe-invoicing.ts", "serve"]|' "$author/Dockerfile"
  commit_upstream "drill: v5, the new migration and an app that starts"
  v5="$(git -C "$author" rev-parse HEAD | cut -c1-12)"
  before="$(archives | tail -n 1)"
  succeeds "$scripts/deploy.sh"
  { [[ "$(env_value IMAGE_TAG)" == "$v5" ]] && runs_image "$v5" && doctor_ok; } || fail "deploy $v5: $(tail -n 10 "$log")"
  older="$(archives | tail -n 1)"
  [[ "$older" != "$before" ]] || fail "the deploy of $v5 made no backup"
  for tag in 0123456789ab "$v3" "$v4"; do ! docker image inspect "$project:$tag" >/dev/null 2>&1 || fail "$tag was not pruned"; done
  docker image inspect "$project:$v2" >/dev/null || fail "pruned the previous image $v2"
  pass "deploy $v5 with a new migration; image retention: only $v5 and the previous $v2 kept"
}

# (a) An archive older than the image: restored, then migrated on the target before the switch.
restore_older_archive() {
  local archive="$1" source target
  source="$(env_value QWBE_PGDATABASE)"
  succeeds sh -c "$(confirmed "$archive")"
  { grep -q 'migrate  catalog/catalog-002-drill$' "$log" && grep -q "migrated the target to $project:$v5 (1 applied)" "$log"; } \
    || fail "the plan or the migration: $(tail -n 20 "$log")"
  target="$(env_value QWBE_PGDATABASE)"
  [[ "$target" != "$source" && "$(env_value IMAGE_TAG)" == "$v5" ]] || fail "the switch: $(grep -E '^(QWBE_PGDATABASE|IMAGE_TAG)=' "$checkout/.env")"
  doctor_ok ".schemaDrift == [] and .pendingMigrations == [] and .database.database == \"$target\"" || fail "doctor on the migrated target"
  [[ "$(drill_psql "$target" "SELECT to_regclass('drill_marker') IS NOT NULL")" == t ]] || fail "drill_marker missing on the target"
  [[ ",$(databases)," == *",$source,"* ]] || fail "the source $source was not kept"
  login
  [[ "$(pdf_status "$first_invoice")" == 200 ]] || fail "the restored invoice PDF"
  pass "an archive older than the image: restored, catalog-002-drill applied by migrate, switched with IMAGE_TAG $v5 unchanged, source kept"
}

# (b) An archive newer than the image (an older one installed): refused before anything is created.
restore_newer_refused() {
  succeeds "$scripts/backup.sh"
  newer="$(archives | tail -n 1)"
  local dbs vols
  dbs="$(databases)" vols="$(volumes)"
  cp "$checkout/.env" "$work/env.v5"
  set_env IMAGE_TAG "$v2"
  local refusal='newer than this image, which does not know: catalog/catalog-002-drill'
  refused "$refusal" "$scripts/restore.sh" "$newer"
  refused "$refusal" sh -c "$(confirmed "$newer")"
  [[ "$(databases)" == "$dbs" && "$(volumes)" == "$vols" ]] || fail "a refused newer archive left a database or a volume"
  cp "$work/env.v5" "$checkout/.env"
  pass "an archive newer than the image: dry-run and --apply refused, no database or volume created"
}

# (c) An image whose migration fails, never deployed: the target stays for investigation;
# the source, `app` and `.env` are as they were.
restore_migrate_fails() {
  local migrations="$author/cubes/invoicing/catalog/contracts/migrations.json" source dbs
  jq --arg sql "DO \$\$ BEGIN RAISE EXCEPTION 'drill: this migration fails'; END \$\$" \
    '. + [{name: "catalog-003-drill-fails", statements: [$sql]}]' "$migrations" > "$work/migrations.fails.json"
  cp "$migrations" "$work/migrations.v5.json"
  cp "$work/migrations.fails.json" "$migrations"
  docker build -q -t "$project:fails" "$author" >/dev/null || fail "building $project:fails"
  cp "$work/migrations.v5.json" "$migrations"
  set_env IMAGE_TAG fails
  cp "$checkout/.env" "$work/env.fails"
  source="$(env_value QWBE_PGDATABASE)" dbs="$(databases)"
  refused 'migrate failed on the restored target .*the source and .env are unchanged' sh -c "$(confirmed "$newer")"
  grep -q 'drill: this migration fails' "$log" || fail "the migration's error is not shown: $(tail -n 15 "$log")"
  cmp -s "$checkout/.env" "$work/env.fails" || fail ".env changed by a restore whose migration failed"
  [[ "$(databases)" != "$dbs" ]] || fail "the failed target was not left for investigation"
  { runs_image "$v5" && doctor_ok ".database.database == \"$source\""; } || fail "the source does not serve as before"
  cp "$work/env.v5" "$checkout/.env"
  pass "a migration that fails on the restored target: target left, source still serving, .env unchanged"
}
