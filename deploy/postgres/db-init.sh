#!/bin/sh
# The `db-init` service (compose.yaml, compose.prod.yaml, compose.preview.yaml): grants.sql on PGDATABASE as the
# `postgres` superuser, then the passwords of qwbe_owner and qwbe_app from their secrets,
# in one transaction. It runs as root in the postgres image because only root can read the
# operator's 0600 secret files there; the entrypoint's initdb scripts run as `postgres`.
# Idempotent, so it runs before every `migrate` and on a restore's new database.
#
# The passwords are read by psql itself (backquotes in a \set), so none of them is ever an
# argument; the superuser's is in PGPASSWORD of this one-off process only. VERBOSITY=terse
# keeps a failed statement's text, a password included, out of the client's error, and
# log_min_error_statement=PANIC (this transaction only) keeps it out of the server log.
set -eu

secrets=/run/secrets
for name in pg_superuser_password pg_owner_password pg_app_password; do
  [ -s "$secrets/$name" ] || { echo "db-init: $secrets/$name is missing or empty" >&2; exit 1; }
done
PGPASSWORD="$(cat "$secrets/pg_superuser_password")"
export PGPASSWORD

# shellcheck disable=SC2016  # the backquotes are psql's, run by psql, not by this shell
printf '%s\n' \
  '\set owner_password `cat /run/secrets/pg_owner_password`' \
  '\set app_password `cat /run/secrets/pg_app_password`' \
  'SET LOCAL log_min_error_statement = PANIC;' \
  "ALTER ROLE qwbe_owner PASSWORD :'owner_password';" \
  "ALTER ROLE qwbe_app PASSWORD :'app_password';" \
  | psql --no-psqlrc --quiet --single-transaction --set=ON_ERROR_STOP=1 --set=VERBOSITY=terse \
    --host="${PGHOST:?}" --username=postgres --dbname="${PGDATABASE:?}" \
    --file="$(dirname "$0")/grants.sql" --file=-
echo "db-init: roles and grants applied on $PGDATABASE"
