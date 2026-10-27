# Release bundle — install, upgrade, backup, restore, rollback

Each versioned release publishes one image, for `linux/amd64` + `linux/arm64`, to the GHCR path of the repository that ran the release workflow (for this repository `ghcr.io/bogdanignat/qwbe-invoicing:<version>`). The image is the kernel: it serves the UI (the Vite build in `frontend/dist`, `QWBE_UI_DIR`) and `/api` on one origin, `PUBLIC_ORIGIN`. `image-digests.txt` lists its multi-arch digest; set `QWBE_IMAGE` to the registry path and pin `IMAGE_TAG` to that digest. The release should ship:

```text
compose.prod.yaml
compose.loopback.yaml
compose.ipv4-only.yaml   (only for a host without IPv6)
.env.example
Caddyfile.example
image-digests.txt
docs/RELEASE.md   (this file)
docs/LOCAL_DEVELOPMENT.md
docs/ANAF.md
scripts/init-secrets.sh
scripts/production/lib.sh, backup.sh, restore.sh   (deploy.sh needs a git checkout)
deploy/postgres/grants.sql, db-init.sh   (the database roles; mounted by db-init)
deploy/systemd/qwbe-invoicing-backup.service, .timer
```

Building from a checkout instead of pulling a release is the README's "Quick start
(self-host)": `docker build -t qwbe-invoicing:local .` with `QWBE_IMAGE=qwbe-invoicing`
and `IMAGE_TAG=local`. Every step below is the same for both.

## Source verification before building a release

Caddy and Traefik route the public traffic to `app`, the one image. Run
`scripts/verify-docker.sh verify` (the full `pnpm verify`, in throwaway databases on the project's PostgreSQL 16)
before building the image; the release workflow runs the same harness. The size gate keeps the existing
6,000-character file cap and the 40,000-character / 15-file cube caps; it also checks
production source files under `kernel/` and `frontend/src/` without treating these
trees as a cube. `bin/` and root tooling/config files are outside that file-only extension.

Host/UI refactors must also preserve the HTTP contract and runtime error/idempotency
mapping, transaction behavior, session lifetime and PDF assets. Verify browser flows
on an isolated fixture and smoke-test the built runtime, not a live data volume.

`pnpm verify` includes `pnpm test:app:runtime` (`probes/app-runtime*.mjs`): after the
frontend build it runs the real CLI, `migrate --apply` and then `serve` with the built
`frontend/dist` as `QWBE_UI_DIR`, on a fresh database of the verifier's PostgreSQL, and
checks over HTTP the login, resume, CSRF, logout and refused replay, the session cookie
attributes, the Host, Origin and `Authorization` refusals, the security headers on the
SPA, its assets and the errors, the deep-link fallback, the missing-asset 404, `GET /api`
without a session, and a PDF and an e-Factura XML download.

The verifier never runs the shipped image. Before a release, smoke-test it:

```bash
scripts/smoke-image.sh          # SMOKE_PORT (default 3199) must be free on 127.0.0.1
```

It builds `qwbe-invoicing:smoke` from the `Dockerfile` and starts `compose.prod.yaml` +
`compose.loopback.yaml` as the separate Compose project `qwbe-smoke`, with a temporary
`.env` made from `.env.example` and secrets made by `scripts/init-secrets.sh`. It checks
that `migrate` exits 0, `/health/ready` answers 200, `/` is the SPA with the CSP, a
hashed asset is `immutable`, and the login on the configured origin answers a `Secure`
session cookie that resumes. At exit, whatever the result, it runs `down -v` on that
project and removes the temporary directory. `compose.prod.yaml` names its volumes
`qwbe-invoicing-*`, which on a development host are the local stack's: the script renames
them to `qwbe-smoke-*` with an override and refuses to start if any volume of the project
would not be one of those, so `down -v` cannot reach another stack's data.

`pnpm gate:boundaries` checks all of `frontend/src` alongside the cube and host trees.
It runs in `pnpm verify`, also used by the release CI verification job. Frontend source
dependencies follow this matrix:

| Source | Allowed targets within `frontend/src` |
| --- | --- |
| `lib/` | `lib/` |
| `hooks/` | `lib/`, `hooks/` |
| `components/` | `lib/`, `hooks/`, `components/` |
| `views/` | `lib/`, `hooks/`, `components/`, `views/` |
| `routes/` | `lib/`, `hooks/`, `components/`, `views/`, `routes/` |

The entrypoint `main.tsx` and the generated `routeTree.gen.ts` compose the layers, and
no layer imports them or any other file outside the five folders. Type-only imports,
re-exports and dynamic imports follow the same rules, and cycles are forbidden.
Everything under `frontend/src` is browser code (only the `*.test.ts` files next to it
run in Node): no Node core module, no `frontend/vite.config.ts` or other config file in
`frontend/`, no `frontend/scripts/` and no build-time package (`vite`, `@vitejs/*`,
`@tailwindcss/vite`, `@tanstack/router-plugin`, `@tanstack/router-generator`), directly
or through another module. Frontend source cannot import `cubes/`, `kernel/`, `probes/`,
`bin/`, `scripts/` or the Vite build output in `frontend/dist`, and the backend cannot
import `frontend/`. The CLI fixture tests in
`probes/frontend-boundary-gate.test.mjs` exercise allowed edges and rejected violations;
no size thresholds or cube rules are relaxed.

## Install (first time, production host)

```bash
# 1. The bundle, in its own directory
mkdir -p /opt/qwbe-invoicing && cd /opt/qwbe-invoicing
cp /path/to/release/{compose.prod.yaml,compose.loopback.yaml,compose.ipv4-only.yaml,Caddyfile.example} .
mkdir -p scripts && cp /path/to/release/scripts/init-secrets.sh scripts/
# db-init runs these on every start: the roles, grants and passwords (README, "Database access")
mkdir -p deploy/postgres && cp /path/to/release/deploy/postgres/{grants.sql,db-init.sh} deploy/postgres/
cp /path/to/release/.env.example .env
# Edit .env (each key is documented there):
#   PUBLIC_ORIGIN=https://invoice.example.com   (required: the origin users type)
#   QWBE_IMAGE=ghcr.io/<owner>/qwbe-invoicing   (the registry path of the release)
#   IMAGE_TAG=0.3.0@sha256:<digest>             (required, from image-digests.txt)
#   ORGANIZATION_ID=...                         (once, never changed afterwards)
#   QWBE_PGDATABASE=qwbe_invoicing / QWBE_DATA_VOLUME=qwbe-invoicing-data (required; a restore switches them)
#   BACKUP_DIR=/var/backups/qwbe-invoicing      (for scripts/production/; absolute, outside the checkout)
#   AUTH_TOKEN_PATH / PG_SUPERUSER_PASSWORD_PATH / PG_OWNER_PASSWORD_PATH / PG_APP_PASSWORD_PATH /
#   COMPANY_LOOKUP_KEY_PATH / ANAF_TOKEN_KEY_PATH (required; .local/ by default)
sudo install -d -m 0770 -o "$USER" -g 1000 /var/backups/qwbe-invoicing   # writable by you and the image's `node`

# 2. The six secrets, at those paths: mode 0600, never overwritten, never printed
scripts/init-secrets.sh

# 3. TLS, one of:
#    a) the bundled Caddy: copy the Caddyfile, set the host of PUBLIC_ORIGIN in it
cp Caddyfile.example Caddyfile
#    b) your own proxy on this host: APP_LOOPBACK_PORT=3180 in .env, and the proxy
#       passes Host and X-Forwarded-Proto and overwrites X-Forwarded-For with the
#       client (nginx: $remote_addr, not $proxy_add_x_forwarded_for; README, "Quick
#       start (self-host)"); one that cannot: QWBE_TRUSTED_PROXY= (empty)
#    Both reach `app` from the project network (QWBE_NETWORK_SUBNET, default
#    10.93.0.0/24; QWBE_NETWORK_SUBNET_IPV6, default fd93:1c5e:a7b0::/64), which
#    QWBE_TRUSTED_PROXY trusts by default. If `up` reports that a pool overlaps a
#    network of this host, pick another subnet there; on a host without IPv6, add
#    compose.ipv4-only.yaml to COMPOSE_FILE. IPv6 visitors keep their address through Caddy only
#    with Docker 27+ and ip6tables on (the default); otherwise they share one bucket.

# 4. Start: migrate runs first, app starts only on success
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml --profile proxy up -d                  # a)
docker compose -f compose.prod.yaml -f compose.loopback.yaml up -d         # b)

# 5. Verify: no secret is printed; nothing is published except Caddy's 80/443 (a)
#    or 127.0.0.1:APP_LOOPBACK_PORT (b)
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
docker compose -f compose.prod.yaml exec app wget -qO- http://127.0.0.1:3000/health/ready
curl -fsS https://invoice.example.com/health/ready
```

The commands below are written for a); with b), replace `--profile proxy` by
`-f compose.loopback.yaml` wherever the stack is started. Setting `COMPOSE_FILE` and
`COMPOSE_PROFILES` in `.env` (see `.env.example`) makes both unnecessary.

Requirements enforced by the bundle: `read_only: true` with bounded `tmpfs`, named volume `qwbe-invoicing-data`, `depends_on: migrate: service_completed_successfully` (and `migrate` on `db-init`), `HEALTHCHECK` on `/health/ready`, secrets from file, three database roles (`app` connects as `qwbe_app`, DML only; `migrate` as `qwbe_owner`; the `postgres` superuser only in `db` and `db-init`), no fallback for `PUBLIC_ORIGIN`, `IMAGE_TAG` or the five secret paths, `cap_drop: [ALL]` and `no-new-privileges` on every service (`db` adds back `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID`, `SETUID` for its entrypoint, `db-init` `DAC_READ_SEARCH` to read the secret files as root, Caddy `NET_BIND_SERVICE`), PostgreSQL and Caddy pinned by version and digest in `compose.prod.yaml` itself (only the application image is in `image-digests.txt`), the project network on fixed IPv4 and IPv6 subnets that `QWBE_TRUSTED_PROXY` trusts by default, and HSTS (`max-age=31536000`) sent by the application on an `https:` `PUBLIC_ORIGIN`.

Compose does not move an existing network to other subnets. An installation whose network
was created before the subnets were fixed (or before they changed in `.env`) needs, once,
`docker compose -f compose.prod.yaml down` without `-v`, which removes the containers and the
network and keeps every volume, then `up -d`. `deploy.sh` checks this before it stops
anything (Upgrade, step 3).

## Production scripts

`scripts/production/` automates the procedures below for an installation that runs
from a checkout of `main`. Each script reads `.env` restrictively (a plain value per
key; interpolation, quotes and spaces are refused), uses the Compose files of
`COMPOSE_FILE` (or `compose.prod.yaml`) and holds one host lock,
`.local/production/lock`, for its whole run, so the backup timer, a deploy and a
restore never interleave. A second one refuses at once. Nothing they print or log
holds a secret.

| Script | What it does |
| --- | --- |
| `deploy.sh` | Upgrade: pull, build, backup, start, roll back or ask for a restore (Upgrade, Rollback) |
| `backup.sh` | One archive in `BACKUP_DIR`, never deleting one; run daily by the systemd timer (Backup) |
| `restore.sh <archive> [--apply]` | Dry-run, or restore any archive into a new database + volume with the installed image, migrate it and switch (Restore) |

Before a script stops `app` it writes `.local/production/app-stopped` (who stopped it,
when), and removes it once `app` runs again. A run cut short before that (SIGKILL,
power loss, the backup unit's stop timeout) leaves it behind, and `deploy.sh` and
`backup.sh` then refuse, printing it: what the interrupted run changed is not known to
the next one, so restarting is the operator's decision. Check `docker compose ps` and
`logs migrate app`, start the stack (`up -d`), then remove the file. `restore.sh
--apply` only warns: it ends by starting the stack on the restored target and clears it.
On INT/TERM the scripts finish the command in progress (a backup or restore run can
take minutes), then clean up as on any failure.

The manual steps in each section stay as the fallback, and they are what the scripts
run. The scripts are checked by `scripts/production/drill.sh`, on an isolated stack
of its own (project, image repository and volumes `qwbe-drill`), never on this one.

## Upgrade

From a checkout, one command (an upgrade of a running installation; the first install
is above):

```bash
scripts/production/deploy.sh
```

1. Refuses unless `.env` and the Compose files are valid, the checkout is `main` and
   clean (untracked files too), `app` runs the image `.env` names, no recovery is
   pending and no other operation holds the lock.
2. Records the active version: the ID of the image `app` runs, and the commit.
3. `git pull --ff-only` and `docker build`, tagged `${QWBE_IMAGE}:<12-hex commit>`;
   the running version keeps its own tag. Then the project network must have the
   subnets the new Compose files fix (`docker network inspect`); otherwise the deploy
   stops with the `down` / `up -d` to run first. Until here production runs untouched,
   and a failure (pull, build, new Compose files that reject `.env`, a network on other
   subnets) ends without downtime.
4. Stops `app` and backs up with the active image (`backup.sh`, below). Without a
   verified backup the deploy stops and the previous `app` starts again.
5. Only then writes the new `IMAGE_TAG` to `.env` (the previous copy is kept in
   `.local/production/`) and starts `migrate`, `app` and the rest; ready means
   healthy and `doctor --json` answering `ready: true`.
6. On success, removes the `${QWBE_IMAGE}:<commit>` images other than the new one and
   the previous one. Every backup stays restorable without the image that made it:
   `restore.sh` restores with the installed image and migrates (Restore, below).

Failures are in Rollback, below. Every failure exits non-zero.

Upgrading to the first version with fixed network subnets, by script or by hand:

- delete an explicit `QWBE_TRUSTED_PROXY` from `.env` that names the old Compose network
  (for example `172.18.0.0/16`): it no longer covers the new subnets, and the throttle
  would silently go back to one bucket for everyone. Unset, the default follows
  `QWBE_NETWORK_SUBNET` and `QWBE_NETWORK_SUBNET_IPV6`;
- by hand, recreate the network once before the steps below, in a maintenance window:
  `docker compose -f compose.prod.yaml down` (no `-v`), then `up -d` with the running version.

The manual procedure, also for a release image:

```bash
cd /opt/qwbe-invoicing
# 1. Back up FIRST, with the version that is running now: .env still names it.
#    `--no-deps` is required: a plain `run` starts `app`'s dependencies, and the
#    `migrate` service would apply the schema before the backup exists.
docker compose -f compose.prod.yaml stop app
docker compose -f compose.prod.yaml run --rm --no-deps app node bin/qwbe-invoicing.ts backup --output /data/backup-$(date +%F).tar.gz --json
# 2. Only now pin the new version: edit IMAGE_TAG in .env (digest-pinned from the
#    new image-digests.txt), not in the shell, so a later `up -d` from a fresh shell
#    does not fall back to the previous version. Then pull it.
docker compose -f compose.prod.yaml pull
# 3. Start: `migrate` runs with the new image, `app` starts only if it succeeds
docker compose -f compose.prod.yaml --profile proxy up -d
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts artifacts --limit 50 --json
docker compose -f compose.prod.yaml logs --tail=100 migrate app
```

From a checkout by hand, build the new version under a tag of its own, never over the
running one, so the previous image stays for a rollback: `git pull --ff-only`, then
`docker build -t qwbe-invoicing:$(git rev-parse HEAD | cut -c1-12) .` while the old
version still serves; then step 1, then that tag as `IMAGE_TAG` (step 2, without
`pull`) and step 3. This is what `deploy.sh` does.

The upgrade is incremental: `migrate` applies only the migrations the database lacks,
each in its own transaction with its ledger row, and the shipped ones never change
(README, "Schema and migrations"). `migrate` refuses a database whose schema its
history does not explain before writing anything, so `app` does not start on it.
`doctor --json` is the readiness gate and reports
`pendingMigrations`, `migrationsReady` and `schemaDrift`. `artifacts` is a dry-run by
default and now reports both invoices and proformas missing PDFs; use `--apply`
(plus `--confirm-production` outside development) only to reconcile at most
`--limit` documents, one successful PDF at a time.

Never use `docker compose down -v` as an upgrade step — it deletes the named volume.

## Backup

```bash
scripts/production/backup.sh
```

Checks `BACKUP_DIR` first (a real directory, writable by you and, by a test write, by
the image's `node` user), then stops `app`, backs up with the image `app` was running,
and starts `app` again, also when the backup fails; an `app` that was not running stays
stopped. Success is the CLI's report (exit 0, `failed` 0, `copied` equal to `scanned`);
only then the archive gets its final name, `BACKUP_DIR/qwbe-invoicing-<UTC time>.tar.gz`,
with `qwbe-invoicing-<UTC time>.meta` next to it: image, image ID, commit,
`ORGANIZATION_ID`, database and data volume, no secret. The `.meta` is for people:
`restore.sh` reads only the archive and its manifest. The backup deletes no
archive: removing old archives, and copying them to another machine, is the
administrator's job.

`app` is down for the whole backup: the dump (the CLI bounds it at ten minutes), the
copy, the compression and the verification, within the archive limits (4,096 members,
512 MiB per member, 1 GiB expanded). Measure it on your data before choosing the hour.

The archives stay in `BACKUP_DIR`, on this host. Copying them off it (and the
operator config listed below) is the server administrator's responsibility; a backup
on the same machine does not survive the loss of the machine.

Daily at 03:30 Europe/Bucharest, with the systemd units (adjust `WorkingDirectory`,
`ExecStart` and `User` to the installation first):

```bash
sudo cp deploy/systemd/qwbe-invoicing-backup.service deploy/systemd/qwbe-invoicing-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now qwbe-invoicing-backup.timer
systemctl list-timers qwbe-invoicing-backup.timer        # the next run
journalctl -u qwbe-invoicing-backup.service -n 50        # the log of the last runs
```

`Persistent=true` catches up a run missed while the host was down, at the next boot,
so that backup's downtime can then happen outside 03:30. While a deploy or a restore
holds the lock, the timer's run fails at once and the unit shows it (`systemctl
--failed`); the deploy makes its own backup.

The service allows 30 minutes per run (`TimeoutStartSec`). When that, or a `systemctl
stop`, ends a run, systemd sends SIGTERM to the script, which first finishes the
current command (up to the whole CLI backup), then removes the partial archive and
starts `app` again; `TimeoutStopSec=15min` leaves room for that. Only if that is
exceeded does SIGKILL end everything: `app` stays stopped and `app-stopped` makes the
next run refuse (Production scripts, above). A `.partial-*` file left by such a run is
not an archive; remove it by hand.

## Restore

```bash
scripts/production/restore.sh /var/backups/qwbe-invoicing/qwbe-invoicing-<time>.tar.gz           # dry-run
scripts/production/restore.sh /var/backups/qwbe-invoicing/qwbe-invoicing-<time>.tar.gz --apply   # restore + switch
```

- Any archive made by `backup.sh` restores with the image installed now, `IMAGE_TAG`
  in `.env`, which the restore never changes. The `.meta` next to the archive is not
  needed.
- First, before anything is created, that image inspects the archive
  (`backup-inspect`, in `migrate`): every member against its manifest, the archive's
  migrations against the image's, the manifest's organization against
  `ORGANIZATION_ID`. A broken archive, migrations the image does not know (an archive
  newer than the image: install that version, or a newer one, first), a history with
  gaps, or another organization is a refusal, and nothing is made. The plan names the
  migrations the archive lacks; `--apply` applies them.
- The dry-run is a preliminary check only: the inspection, then an empty database
  (dropped again once confirmed empty) and an empty read-only `/data`, the CLI's
  restore plan, nothing switched, no volume made.
- `--apply` shows the archive and its time, the source, the target, the image, the
  migrations to apply and the organization, and asks for the archive name. It creates
  a new database `<QWBE_PGDATABASE>_r<time>` owned by `qwbe_owner`, runs `db-init` on
  it, creates the volume `<QWBE_DATA_VOLUME>-r<time>`, restores in `migrate` (as
  `qwbe_owner`; the restored ledger must equal the manifest), runs `migrate --apply`
  on the target (drift checked before and after), then `doctor` in `app` (as
  `qwbe_app`); only when that is ready it stops `app`, writes `QWBE_PGDATABASE` and
  `QWBE_DATA_VOLUME` to `.env` in one atomic write (the previous copy is in
  `.local/production/`), starts the stack and checks `doctor` on the new database.
- While a failed deploy's `recovery-required` exists, the restore first checks that
  `.env` names the image that made that deploy's backup, with the ID the marker
  records; otherwise it refuses before anything is created and prints step 1 of the
  marker (pin the image, set `IMAGE_TAG` back), to run first.
- A failed restore, a failed migration included, leaves its target as it is for
  investigation, with the source and `.env` unchanged; a new attempt makes a new
  target. The source database and volume are never deleted or changed.
- If the switch itself does not finish (INT/TERM, a stack that is not ready), the exit
  says whether `.env` was switched (read from `.env` itself), where its previous copy
  is, and the commands to go on with the target, back to the source, or to restore
  again. Going back to the source is not offered while a failed deploy's
  `recovery-required` exists: that source may hold the failed version's schema.
  Nothing is started from there; `app-stopped` stays until the operator has done it.
- What is lost: everything written after the backup (documents, numbers, payments,
  e-Factura submissions) is absent from the restored installation and remains only in
  the source database. Sessions and the ANAF OAuth connection are not restored: users
  unlock again, e-Factura is reconnected with the certificate, and submissions that
  were in flight become `unknown`.

## Backup and restore by hand (fallback)

Backup reads the database and writes only the archive; repeating it produces the same contents. The archive holds `manifest.json`, a plain `pg_dump` of the one database as `database.sql` and the `/data/artifacts` tree, with a SHA-256 per member — therefore it includes proforma records/conversion metadata, proforma artifact metadata and proforma PDF files without a separate backup command or format. `browser_sessions` keeps its definition and loses its rows, so no live cookie survives a restore.

Both commands take the maintenance key EXCLUSIVE as a *try* and refuse immediately while `app` holds it SHARED: stop `app` first. Every `run` below carries `--no-deps`: `db` is already up, and without it Compose would also start the `migrate` service and change the schema of the database being backed up or restored. `restore --apply` executes `database.sql` through `psql` as the schema owner role (`qwbe_owner`, NOSUPERUSER), so it runs in the `migrate` service — only an archive you trust may be applied; a `database.sql` that pg_dump's `\restrict <key>` ... `\unrestrict <key>` does not wrap whole is refused by the dry run, `--apply` and `backup-inspect`, so psql runs none of its backslash meta-commands — and requires an **empty** target database: create a fresh one owned by `qwbe_owner`, run `db-init` on it before the restore (its grants give `qwbe_app` its rights on every object the restore creates) and point `QWBE_PGDATABASE` at it. Nothing is ever dropped.

```bash
# Backup — stop app first; `run --rm --no-deps app` carries the same environment and secrets
docker compose -f compose.prod.yaml stop app
docker compose -f compose.prod.yaml run --rm --no-deps app node bin/qwbe-invoicing.ts backup --output /data/backup-$(date +%F).tar.gz --json
# Or to a host directory (recommended: not inside the data volume):
mkdir -p /opt/qwbe-invoicing/backups
docker compose -f compose.prod.yaml run --rm --no-deps -v /opt/qwbe-invoicing/backups:/backup app node bin/qwbe-invoicing.ts backup --output /backup/qwbe-$(date +%F).tar.gz --json
docker compose -f compose.prod.yaml start app

# Restore — into a FRESH, empty database AND a fresh artifact volume: restore
# deletes nothing, so it refuses a populated database or a non-empty /data/artifacts,
# the dry-run included. Create both first:
docker compose -f compose.prod.yaml stop app
docker compose -f compose.prod.yaml exec db psql -U postgres -d postgres \
  -c "CREATE DATABASE qwbe_invoicing_restored OWNER qwbe_owner TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C' ENCODING 'UTF8'"
docker compose -f compose.prod.yaml run --rm --no-deps -e PGDATABASE=qwbe_invoicing_restored db-init
docker volume create qwbe-invoicing-data-restored
# Inspect the archive: no database, no secret; exit 0 only when this image can restore it.
docker compose -f compose.prod.yaml run --rm --no-deps -e TMPDIR=/var/backups/staging \
  -v invoicing-backup-staging:/var/backups/staging -v /opt/qwbe-invoicing/backups:/backup:ro migrate \
  node bin/qwbe-invoicing.ts backup-inspect --input /backup/qwbe-2026-08-31.tar.gz --json
# Dry-run against that target: verifies the whole archive, writes nothing. In `migrate`
# (qwbe_owner), staging on the staging volume: `migrate` has only a small /tmp.
docker compose -f compose.prod.yaml run --rm --no-deps -e PGDATABASE=qwbe_invoicing_restored \
  -e TMPDIR=/var/backups/staging -v invoicing-backup-staging:/var/backups/staging \
  -v qwbe-invoicing-data-restored:/data -v /opt/qwbe-invoicing/backups:/backup:ro migrate \
  node bin/qwbe-invoicing.ts restore --input /backup/qwbe-2026-08-31.tar.gz --json
# Apply
docker compose -f compose.prod.yaml run --rm --no-deps -e PGDATABASE=qwbe_invoicing_restored \
  -e TMPDIR=/var/backups/staging -v invoicing-backup-staging:/var/backups/staging \
  -v qwbe-invoicing-data-restored:/data -v /opt/qwbe-invoicing/backups:/backup:ro migrate \
  node bin/qwbe-invoicing.ts restore --input /backup/qwbe-2026-08-31.tar.gz --apply --confirm-production --json
# Point the stack at both: QWBE_PGDATABASE=qwbe_invoicing_restored and
# QWBE_DATA_VOLUME=qwbe-invoicing-data-restored in .env (IMAGE_TAG unchanged: `up -d`
# runs `migrate`, which applies what the archive lacks), then verify
docker compose -f compose.prod.yaml --profile proxy up -d
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
```

Separately protect `.env` (`PUBLIC_ORIGIN`, `ORGANIZATION_ID`, `IMAGE_TAG`), the contents of the six secret files, `Caddyfile`/`compose.prod.yaml` edits and `image-digests.txt` — they are operator config, not part of the data backup. A restored database needs the same `ORGANIZATION_ID`; sessions do not survive a restore, so users unlock again.

## Rollback

`deploy.sh` decides from the outcome of its own `migrate` run, never from an exit code
or a word in a log alone:

- **Nothing changed**: `migrate` did not run, or its report says `changed: 0` (this
  includes a refused drift and an `app` that does not start after a migration with
  nothing to apply). The candidate stops, `IMAGE_TAG` goes back and the previous image,
  pinned again to the ID recorded before the deploy, must become ready. Writes the new
  version made while it ran stay: the schema is the same.
- **Schema changed, or unknown** (no report, `migrate` still running or cut short):
  the previous version is not started on that database and `app` stays stopped (a
  `migrate` still running is stopped first, so it cannot change the schema after the
  decision). The deploy pins the previous image to its tag again and writes the
  previous `IMAGE_TAG` back to `.env` (the file is what counts: the scripts ignore an
  `IMAGE_TAG` in the shell), starting nothing. It prints both commands, the image step
  (done, or what failed) and the restore of its own backup, which `restore.sh` makes
  with that previous image, and keeps them in `.local/production/recovery-required`;
  `deploy.sh` and `backup.sh` refuse while that file exists, and a successful
  `restore.sh --apply` removes it. Remove it by hand only once the installation is
  consistent again.

The deploy exits non-zero in every case. By hand:

```bash
# 1. Set IMAGE_TAG in .env back to the previous digest-pinned version (from the
#    previous image-digests.txt; from a checkout, the tag kept before the rebuild).
#    PUBLIC_ORIGIN and the secrets stay as they are. Start nothing yet.
# 2. If the upgrade's `migrate` changed the schema, the previous image refuses it as
#    drift and `app` does not start: restore the backup taken in Upgrade step 1 into a
#    fresh database with that previous image (Restore, above). An unchanged schema
#    skips this.
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml --profile proxy up -d
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
```

If `app` does not become healthy, `docker compose -f compose.prod.yaml logs migrate` shows
why; a drift refusal there means step 2 was needed.

## Offline image bundle (optional)

```bash
docker save ghcr.io/<owner>/qwbe-invoicing:0.3.0 | gzip > qwbe-invoicing-0.3.0-image.tar.gz
# On the air-gapped host. Pin IMAGE_TAG=0.3.0 there: depending on the image store, a
# loaded image may not resolve by its registry digest, and Compose would try to pull.
gunzip -c qwbe-invoicing-0.3.0-image.tar.gz | docker load
```

## Security and audit notes

- Secrets are mounted from `${AUTH_TOKEN_PATH}`, `${PG_SUPERUSER_PASSWORD_PATH}`, `${PG_OWNER_PASSWORD_PATH}`, `${PG_APP_PASSWORD_PATH}` and `${COMPANY_LOOKUP_KEY_PATH}` as Compose secrets (`/run/secrets/*`), never baked into the image or printed; `scripts/init-secrets.sh` creates them and never prints or overwrites one. `doctor --json` reports only `authTokenReadable`, never the value.
- `issued_invoices`, `issued_lines`, `issued_tax_breakdown`, `proformas`, `proforma_lines`, `proforma_tax_breakdown`, legacy `proforma_conversions`, direct `proforma_invoice_conversions`, invoice/proforma artifact metadata, and document sequences are append-only or guarded by triggers — verified by current migrations and the boundary/size gates (`pnpm verify`). Direct mutation of an issued fiscal snapshot must fail with `issued invoices are immutable`; sealed proformas and both conversion audit records are likewise immutable.
- Keep invoice and proforma artifacts immutable: the PDF object key is `sha256/<2>/<64>.pdf` and reads verify key + digest + byte length. Proforma PDFs are marked `DOCUMENT NEFISCAL`; they carry no e-Factura, payment, or correction semantics and delivery means download, not email.
