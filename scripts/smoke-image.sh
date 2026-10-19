#!/usr/bin/env bash
# Smoke-test the shipped image the way a self-host runs it: build it from the
# Dockerfile, start compose.prod.yaml + compose.loopback.yaml as its own Compose
# project, and check it over HTTP on the loopback port, as a reverse proxy would.
#
# Checks: `migrate` ran and exited 0; /health/ready is 200; `/` is the SPA with the
# CSP; a hashed asset is `immutable`; login on PUBLIC_ORIGIN answers a Secure
# session cookie and the session resumes.
#
# Side effects, all undone at exit, success or not: the image tag
# qwbe-invoicing:${SMOKE_IMAGE_TAG} (kept, it is a build cache), a temporary directory
# with a `.env` made from .env.example and three secrets made by
# scripts/init-secrets.sh, and the Compose project `qwbe-smoke` with its own volumes,
# renamed to `qwbe-smoke-*` by an override in that directory. compose.prod.yaml names
# its volumes `qwbe-invoicing-*`, which on a development host are the local stack's,
# so the script refuses to start unless every volume of the project is `qwbe-smoke-*`;
# `down -v` at the end removes only those. The checkout's own `.env` and `.local/` are
# never read or written.
#
# Usage: scripts/smoke-image.sh            (SMOKE_PORT, default 3199, must be free)
# Exit codes: 0 every check passed, 1 a check failed, 2 refused to start.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project=qwbe-smoke
port="${SMOKE_PORT:-3199}"
tag="${SMOKE_IMAGE_TAG:-smoke}"
origin=https://invoice.smoke.test
host="${origin#https://}"
work="$(mktemp -d "${TMPDIR:-/tmp}/qwbe-smoke.XXXXXX")"
compose=(docker compose -p "$project" --project-directory "$root" --env-file "$work/.env"
  -f "$root/compose.prod.yaml" -f "$root/compose.loopback.yaml" -f "$work/volumes.yaml")
started=0

cleanup() {
  if [[ "$started" == 1 ]]; then "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || echo "smoke: down -v failed" >&2; fi
  rm -rf "$work"
}
trap cleanup EXIT

fail() { echo "smoke: FAIL $1" >&2; exit 1; }
pass() { echo "smoke: ok   $1"; }

# The bundle's environment, as a self-host writes it, with the secrets in the
# temporary directory (absolute paths: Compose resolves relative ones from the checkout).
sed -e "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=$origin|" -e "s|^IMAGE_TAG=.*|IMAGE_TAG=$tag|" \
  -e "s|^AUTH_TOKEN_PATH=.*|AUTH_TOKEN_PATH=$work/secrets/api-token|" \
  -e "s|^PG_PASSWORD_PATH=.*|PG_PASSWORD_PATH=$work/secrets/pg-password|" \
  -e "s|^COMPANY_LOOKUP_KEY_PATH=.*|COMPANY_LOOKUP_KEY_PATH=$work/secrets/company-lookup-key|" \
  "$root/.env.example" > "$work/.env"
printf 'APP_LOOPBACK_PORT=%s\n' "$port" >> "$work/.env"
"$root/scripts/init-secrets.sh" "$work/.env" >/dev/null
cat > "$work/volumes.yaml" <<YAML
volumes:
  invoicing-data: { name: $project-data }
  invoicing-postgres: { name: $project-postgres }
  invoicing-backup-staging: { name: $project-backup-staging }
  caddy-data: { name: $project-caddy-data }
  caddy-config: { name: $project-caddy-config }
YAML

# The top-level `volumes:` of the merged project, by the names Docker will use.
foreign="$("${compose[@]}" config | awk -v prefix="$project-" '
  /^[^ ]/ { section = $1 }
  section == "volumes:" && /^    name: / && index($2, prefix) != 1 { printf "%s ", $2 }')"
[[ -z "$foreign" ]] || { echo "smoke: refusing to start, volumes outside $project-*: $foreign" >&2; exit 2; }
for name in data postgres backup-staging; do
  ! docker volume inspect "$project-$name" >/dev/null 2>&1 || { echo "smoke: $project-$name exists from an earlier run; remove it first" >&2; exit 2; }
done

docker build -q -t "qwbe-invoicing:$tag" "$root" >/dev/null
pass "image qwbe-invoicing:$tag built"
started=1
"${compose[@]}" up -d --quiet-pull >/dev/null 2>&1 || fail "compose up: $("${compose[@]}" logs --tail=40 migrate app 2>&1)"

state() { docker inspect -f "$1" "$("${compose[@]}" ps -a -q "$2")"; }
for _ in $(seq 1 90); do
  [[ "$(state '{{.State.Health.Status}}' app 2>/dev/null || true)" == healthy ]] && break
  sleep 2
done
[[ "$(state '{{.State.Status}} {{.State.ExitCode}}' migrate)" == "exited 0" ]] || fail "migrate: $("${compose[@]}" logs migrate 2>&1 | tail -20)"
pass "migrate ran and exited 0"
[[ "$(state '{{.State.Health.Status}}' app)" == healthy ]] || fail "app not healthy: $("${compose[@]}" logs --tail=40 app 2>&1)"

base="http://127.0.0.1:$port"
proxy=(-H "Host: $host" -H "X-Forwarded-Proto: https")
curl=(curl -s --max-time 10)
# A substitution that finds nothing answers empty (`|| true`), so the `fail` after it
# says what is missing instead of `set -e` ending the script without a word.
[[ "$("${curl[@]}" -o /dev/null -w '%{http_code}' "$base/health/ready")" == 200 ]] || fail "/health/ready"
pass "/health/ready 200"

headers="$("${curl[@]}" -D - -o "$work/index.html" "${proxy[@]}" "$base/" || true)"
grep -qi "^content-security-policy: default-src 'none'; script-src 'self';" <<<"$headers" || fail "/ has no strict CSP: $headers"
grep -q '<div id="root"></div>' "$work/index.html" || fail "/ is not the SPA"
pass "/ is the SPA, with the CSP"

asset="$(grep -o 'src="/assets/[^"]*\.js"' "$work/index.html" | head -n 1 | cut -d'"' -f2 || true)"
[[ -n "$asset" ]] || fail "no script asset in index.html"
"${curl[@]}" -D - -o /dev/null "${proxy[@]}" "$base$asset" | grep -qi '^cache-control: public, max-age=31536000, immutable' || fail "$asset is not immutable"
pass "$asset is immutable"

# The token is 64 hex characters; printf is a builtin, so it never reaches a command line.
login="$(printf '{"token":"%s"}' "$(cat "$work/secrets/api-token")" \
  | "${curl[@]}" -D - -o /dev/null "${proxy[@]}" -H "Origin: $origin" -H 'Content-Type: application/json' --data-binary @- "$base/api/session" || true)"
grep -q '^HTTP/1.1 200' <<<"$login" || fail "login: $(head -n 1 <<<"$login")"
cookie="$(grep -i '^set-cookie: qwbe_session=' <<<"$login" | tr -d '\r' || true)"
[[ -n "$cookie" ]] || fail "login answered no session cookie"
for attribute in 'Path=/api' HttpOnly 'SameSite=Strict' Secure; do
  grep -q "; $attribute\(;\|$\)" <<<"$cookie" || fail "session cookie without $attribute"
done
session="$(cut -d' ' -f2 <<<"$cookie" | cut -d';' -f1)"
[[ "$("${curl[@]}" -o /dev/null -w '%{http_code}' "${proxy[@]}" -H "Cookie: $session" "$base/api/session")" == 200 ]] || fail "session does not resume"
pass "login on $origin: Secure session cookie, resumed"
echo "smoke: all checks passed"
