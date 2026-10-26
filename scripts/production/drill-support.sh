# shellcheck shell=bash
# The isolated stack of scripts/production/drill.sh: its names, cleanup, the isolation
# check, the helpers that run a production script and read the result, the HTTP API
# calls that make the data, and the setup (upstream, checkout, .env, secrets).

drill_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project=qwbe-drill
port="${DRILL_PORT:-3198}"
origin=https://invoice.drill.test
work="$(mktemp -d "${TMPDIR:-/tmp}/qwbe-drill.XXXXXX")"
author="$work/author" upstream="$work/upstream.git" checkout="$work/checkout" backups="$work/backups"
# shellcheck disable=SC2034  # read by drill.sh
scripts="$checkout/scripts/production"
compose=(docker compose --project-directory "$checkout" --env-file "$checkout/.env"
  -f "$checkout/compose.prod.yaml" -f "$checkout/compose.loopback.yaml" -f "$work/volumes.yaml")
git=(git -c user.name=drill -c user.email=drill@invalid -c init.defaultBranch=main)
started=0 step=0 holder=""

cleanup() {
  [[ -z "$holder" ]] || kill "$holder" 2>/dev/null || true
  if [[ "$started" == 1 ]]; then "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || echo "drill: down -v failed" >&2; fi
  local volume ref
  for volume in $(docker volume ls -q --filter "label=com.docker.compose.project=$project"); do
    [[ "$volume" == "$project-"* ]] && docker volume rm "$volume" >/dev/null
  done
  for ref in $(docker image ls "$project" --format '{{.Repository}}:{{.Tag}}'); do docker image rm "$ref" >/dev/null || true; done
  rm -rf "$work"
}
trap cleanup EXIT

fail() { echo "drill: FAIL $*" >&2; exit 1; }
pass() { echo "drill: ok   $*"; }

# The project's volumes, by the names Docker will use: all of them `qwbe-drill-*`.
isolated() {
  local foreign
  foreign="$("${compose[@]}" config | awk -v prefix="$project-" '
    /^[^ ]/ { section = $1 }
    section == "volumes:" && /^    name: / && index($2, prefix) != 1 { printf "%s ", $2 }')"
  [[ -z "$foreign" ]] || { echo "drill: refusing to go on, volumes outside $project-*: $foreign" >&2; exit 2; }
}

# A production script, its output in a log of its own.
run() {
  isolated
  log="$work/log.$((step += 1))"
  "$@" >"$log" 2>&1
}
succeeds() { run "$@" || fail "$*: $(tail -n 60 "$log")"; }
refused() {
  local pattern="$1"
  shift
  if run "$@"; then fail "not refused: $*"; fi
  grep -qE "$pattern" "$log" || fail "$* failed, but not with /$pattern/: $(tail -n 15 "$log")"
}

env_value() { sed -n "s/^$1=//p" "$checkout/.env" | tail -n 1; }
set_env() { sed -i "s|^$1=.*|$1=$2|" "$checkout/.env"; }
app_image() { docker inspect -f '{{.Image}}' "$("${compose[@]}" ps -q --status running app)"; }
runs_image() { [[ "$(app_image)" == "$(docker image inspect -f '{{.Id}}' "$project:$1")" ]]; }
# doctor in the running app: ready, plus an optional jq condition.
doctor_ok() { "${compose[@]}" exec -T app node bin/qwbe-invoicing.ts doctor --json | jq -e ".ready == true and (${1:-true})" >/dev/null; }
wait_ready() {
  for _ in $(seq 1 90); do [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/health/ready")" == 200 ]] && return; sleep 2; done
  fail "app not ready on port $port"
}
archives() { find "$backups" -maxdepth 1 -type f -name 'qwbe-invoicing-*.tar.gz' | sort; }
commit_upstream() { "${git[@]}" -C "$author" commit -qam "$1" && "${git[@]}" -C "$author" push -q origin main; }

# ---- The HTTP API, through the loopback port, as a reverse proxy would call it ----
api() {
  local method="$1" path="$2" body="${3:-}" key="${4:-}"
  local -a headers=(-H "Host: ${origin#https://}" -H "X-Forwarded-Proto: https" -H "Origin: $origin" -H "Cookie: $cookie"
    -H "x-csrf-token: $csrf" -H "Content-Type: application/json")
  [[ -z "$key" ]] || headers+=(-H "Idempotency-Key: $key")
  [[ -z "$body" ]] || headers+=(--data-binary "$body")
  curl -s --max-time 30 -o "$work/reply" -w '%{http_code}' -X "$method" "${headers[@]}" "http://127.0.0.1:$port$path"
}
login() {
  cookie="" csrf=""
  local reply
  reply="$(printf '{"token":"%s"}' "$(cat "$work/secrets/api-token")" | curl -s --max-time 10 -D - -o "$work/reply" \
    -H "Host: ${origin#https://}" -H "X-Forwarded-Proto: https" -H "Origin: $origin" -H 'Content-Type: application/json' \
    --data-binary @- "http://127.0.0.1:$port/api/session")"
  cookie="$(grep -i '^set-cookie: qwbe_session=' <<<"$reply" | cut -d' ' -f2 | cut -d';' -f1)"
  csrf="$(jq -r .csrfToken "$work/reply")"
  [[ -n "$cookie" && "$csrf" != null ]] || fail "login: $(head -n 1 <<<"$reply")"
}
issue_invoice() {
  local customer='{"partyType":"company","name":"Client SRL","fiscalIdentifier":"87654329","vatRegistered":true,"address":{"countryCode":"RO","city":"Iasi","street":"Strada 2","county":"RO-IS"}}'
  local lines='[{"description":"Servicii","quantity":"1","unitPrice":"100","unitOfMeasure":{"code":"HUR","name":"ora"},"vatRateCode":"RO_STANDARD"}]'
  [[ "$(api POST /api/invoices "{\"customer\":$customer,\"series\":\"QWBE\",\"issueDate\":\"$(date -u -d yesterday +%F)\",\"dueDate\":\"$(date -u -d '+14 days' +%F)\",\"currency\":\"RON\",\"lines\":$lines}" "$1")" =~ ^2[0-9][0-9]$ ]] \
    || fail "issue invoice: $(cat "$work/reply")"
  local id
  id="$(jq -r .id "$work/reply")"
  [[ "$(api POST "/api/invoices/$id/pdf" '{}')" =~ ^2[0-9][0-9]$ ]] || fail "render PDF: $(cat "$work/reply")"
  printf '%s' "$id"
}
pdf_status() { api GET "/api/invoices/$1/pdf"; }

# A snapshot of this working tree as `main` of a local upstream, and a checkout of it.
setup() {
  mkdir -p "$author" "$backups"
  chmod 770 "$backups"
  (cd "$drill_root" && git ls-files -co --exclude-standard -z | tar --null -T - -cf -) | tar -xf - -C "$author"
  "${git[@]}" -C "$author" init -q && "${git[@]}" -C "$author" add -A && "${git[@]}" -C "$author" commit -qm "drill: install"
  git clone -q --bare "$author" "$upstream"
  "${git[@]}" -C "$author" remote add origin "$upstream"
  git clone -q "$upstream" "$checkout"
  sed -e "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=$origin|" -e "s|^QWBE_IMAGE=.*|QWBE_IMAGE=$project|" \
    -e "s|^IMAGE_TAG=.*|IMAGE_TAG=install|" -e "s|^ORGANIZATION_ID=.*|ORGANIZATION_ID=drill-org|" \
    -e "s|^QWBE_DATA_VOLUME=.*|QWBE_DATA_VOLUME=$project-data|" -e "s|^BACKUP_DIR=.*|BACKUP_DIR=$backups|" \
    -e "s|^AUTH_TOKEN_PATH=.*|AUTH_TOKEN_PATH=$work/secrets/api-token|" \
    -e "s|^PG_SUPERUSER_PASSWORD_PATH=.*|PG_SUPERUSER_PASSWORD_PATH=$work/secrets/pg-superuser-password|" \
    -e "s|^PG_OWNER_PASSWORD_PATH=.*|PG_OWNER_PASSWORD_PATH=$work/secrets/pg-owner-password|" \
    -e "s|^PG_APP_PASSWORD_PATH=.*|PG_APP_PASSWORD_PATH=$work/secrets/pg-app-password|" \
    -e "s|^COMPANY_LOOKUP_KEY_PATH=.*|COMPANY_LOOKUP_KEY_PATH=$work/secrets/company-lookup-key|" \
    -e "s|^ANAF_TOKEN_KEY_PATH=.*|ANAF_TOKEN_KEY_PATH=$work/secrets/anaf-token-key|" \
    "$checkout/.env.example" > "$checkout/.env"
  printf '%s\n' "COMPOSE_PROJECT_NAME=$project" "COMPOSE_FILE=compose.prod.yaml:compose.loopback.yaml:$work/volumes.yaml" \
    "APP_LOOPBACK_PORT=$port" "BACKUP_KEEP=3" QWBE_NETWORK_SUBNET=10.93.2.0/24 \
    QWBE_NETWORK_SUBNET_IPV6=fd93:1c5e:a7b2::/64 >> "$checkout/.env"
  "$checkout/scripts/init-secrets.sh" "$checkout/.env" >/dev/null
  # Every fixed volume name, renamed; the data volume follows QWBE_DATA_VOLUME in .env.
  printf '%s\n' volumes: "  invoicing-postgres: { name: $project-postgres }" \
    "  invoicing-backup-staging: { name: $project-backup-staging }" \
    "  caddy-data: { name: $project-caddy-data }" "  caddy-config: { name: $project-caddy-config }" > "$work/volumes.yaml"
  isolated
  [[ -z "$(docker volume ls -q --filter "name=^$project-")" ]] || { echo "drill: $project-* volumes exist from an earlier run; remove them first" >&2; exit 2; }
  pass "isolated: project $project, image $project:*, volumes $project-*"
}

# docs/RELEASE.md "Install", from the checkout, then an issuer, a series and an invoice.
install_with_data() {
  docker build -q -t "$project:install" "$checkout" >/dev/null
  started=1
  "${compose[@]}" up -d --quiet-pull >/dev/null 2>&1 || fail "install: $("${compose[@]}" logs --tail=30 migrate app 2>&1)"
  wait_ready
  login
  [[ "$(api PUT /api/issuer '{"name":"Furnizor SRL","fiscalIdentifier":"12345674","address":{"countryCode":"RO","city":"Iasi","street":"Strada 1","county":"RO-IS"},"legalForm":"srl","tradeRegistryNumber":"J22/123/2020","iban":"RO49AAAA1B31007593840000","bankName":"Banca","socialCapital":"1000","defaultCurrency":"RON","defaultPaymentTermDays":15,"vatChange":{"registered":true,"effectiveFrom":"2025-08-01"},"branding":null}')" =~ ^2[0-9][0-9]$ ]] \
    || fail "issuer: $(cat "$work/reply")"
  [[ "$(api POST /api/document-series '{"documentType":"invoice","series":"QWBE"}')" =~ ^2[0-9][0-9]$ ]] || fail "series: $(cat "$work/reply")"
  first_invoice="$(issue_invoice drill-1)"
  pass "installed $project:install with an issued invoice and its PDF ($first_invoice)"
}
