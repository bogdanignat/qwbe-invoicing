#!/bin/sh
# Create the three secret files a Compose stack mounts, at the paths named in `.env`:
# AUTH_TOKEN_PATH (API token), PG_PASSWORD_PATH (PostgreSQL password) and
# COMPANY_LOOKUP_KEY_PATH (company-lookup master key). Each one is 32 random bytes
# as 64 hex characters, mode 0600, in a directory created 0700 when it is missing.
#
# Idempotent: an existing secret is never overwritten, so a second run changes
# nothing. That matters: PostgreSQL keeps the password it was created with, and a new
# company-lookup key makes the stored openapi.ro key unreadable. Secrets are never
# printed; only their paths and whether they were created or kept.
#
# Usage: scripts/init-secrets.sh [path/to/.env]     (default: ./.env)
# Relative paths in `.env` are resolved from the directory holding it, as Compose does.
# Exit codes: 0 done, 1 refused (nothing past the refusal is written), 2 usage.
set -eu

[ $# -le 1 ] || { echo "usage: scripts/init-secrets.sh [path/to/.env]" >&2; exit 2; }
env_file="${1:-.env}"
[ -f "$env_file" ] || { echo "no env file at $env_file (copy .env.example first)" >&2; exit 1; }
env_dir="$(cd "$(dirname "$env_file")" && pwd)"

fail() { echo "$1" >&2; exit 1; }

# The last `KEY=value` line wins, as in Compose. Only a plain path is accepted:
# interpolation, escapes, inner quotes, comments or spaces are refused rather than
# guessed, so this script never writes somewhere Compose would not read.
path_of() {
  key="$1"
  line="$(grep -E "^[[:space:]]*${key}=" "$env_file" | tail -n 1 || true)"
  [ -n "$line" ] || fail "$key is not set in $env_file"
  value="${line#*=}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  case "$value" in
    "" | *[\$\"\'\\\#[:space:]]*) fail "$key in $env_file must be a plain file path" ;;
  esac
  case "$value" in
    /*) printf '%s\n' "$value" ;;
    *) printf '%s\n' "$env_dir/${value#./}" ;;
  esac
}

random_hex() {
  od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
}

create_secret() {
  key="$1"
  target="$(path_of "$key")"
  if [ -L "$target" ]; then fail "$key: $target is a symlink; refusing to follow it"; fi
  if [ -e "$target" ]; then
    [ -f "$target" ] || fail "$key: $target exists and is not a regular file"
    [ -s "$target" ] || fail "$key: $target exists but is empty; remove it or fill it yourself"
    echo "kept     $key  $target"
    return 0
  fi
  directory="$(dirname "$target")"
  if [ ! -d "$directory" ]; then
    mkdir -p "$directory"
    chmod 700 "$directory"
  fi
  secret="$(random_hex)"
  [ "${#secret}" -eq 64 ] || fail "$key: could not read 32 random bytes from /dev/urandom"
  # noclobber: the redirection refuses an existing file, so a file created between
  # the check above and this line is not overwritten either.
  (set -C; printf '%s\n' "$secret" > "$target") || fail "$key: could not create $target (it appeared meanwhile, or the directory is not writable)"
  chmod 600 "$target"
  echo "created  $key  $target"
}

umask 077
# All three paths are validated before the first file is written.
for key in AUTH_TOKEN_PATH PG_PASSWORD_PATH COMPANY_LOOKUP_KEY_PATH; do path_of "$key" > /dev/null; done
for key in AUTH_TOKEN_PATH PG_PASSWORD_PATH COMPANY_LOOKUP_KEY_PATH; do create_secret "$key"; done
