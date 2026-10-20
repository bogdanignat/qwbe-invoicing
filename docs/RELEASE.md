# Release bundle — install, upgrade, backup, restore, rollback

Each versioned release publishes one image, for `linux/amd64` + `linux/arm64`, to the GHCR path of the repository that ran the release workflow (for this repository `ghcr.io/bogdanignat/qwbe-invoicing:<version>`). The image is the kernel: it serves the UI (the Vite build in `frontend/dist`, `QWBE_UI_DIR`) and `/api` on one origin, `PUBLIC_ORIGIN`. `image-digests.txt` lists its multi-arch digest; set `QWBE_IMAGE` to the registry path and pin `IMAGE_TAG` to that digest. The release should ship:

```text
compose.prod.yaml
compose.loopback.yaml
.env.example
Caddyfile.example
image-digests.txt
docs/RELEASE.md   (this file)
docs/LOCAL_DEVELOPMENT.md
docs/ANAF.md
scripts/init-secrets.sh
```

Building from a checkout instead of pulling a release is the README's "Quick start
(self-host)": `docker build -t qwbe-invoicing:local .` with `QWBE_IMAGE=qwbe-invoicing`
and `IMAGE_TAG=local`. Every step below is the same for both.

## Source verification before building a release

Caddy and Traefik route the public traffic to `app`, the one image. Run
`scripts/verify-docker.sh verify` (the full `pnpm verify`, on a throwaway PostgreSQL 16)
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
cp /path/to/release/{compose.prod.yaml,compose.loopback.yaml,Caddyfile.example} .
mkdir -p scripts && cp /path/to/release/scripts/init-secrets.sh scripts/
cp /path/to/release/.env.example .env
# Edit .env (each key is documented there):
#   PUBLIC_ORIGIN=https://invoice.example.com   (required: the origin users type)
#   QWBE_IMAGE=ghcr.io/<owner>/qwbe-invoicing   (the registry path of the release)
#   IMAGE_TAG=0.3.0@sha256:<digest>             (required, from image-digests.txt)
#   ORGANIZATION_ID=...                         (once, never changed afterwards)
#   AUTH_TOKEN_PATH / PG_PASSWORD_PATH / COMPANY_LOOKUP_KEY_PATH / ANAF_TOKEN_KEY_PATH (required; .local/ by default)

# 2. The four secrets, at those paths: mode 0600, never overwritten, never printed
scripts/init-secrets.sh

# 3. TLS, one of:
#    a) the bundled Caddy: copy the Caddyfile, set the host of PUBLIC_ORIGIN in it
cp Caddyfile.example Caddyfile
#    b) your own proxy on this host: APP_LOOPBACK_PORT=3180 in .env, and the proxy
#       passes Host and X-Forwarded-Proto (README, "Quick start (self-host)")

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

Requirements enforced by the bundle: `read_only: true` with bounded `tmpfs`, named volume `qwbe-invoicing-data`, `depends_on: migrate: service_completed_successfully`, `HEALTHCHECK` on `/health/ready`, secrets from file, and no fallback for `PUBLIC_ORIGIN`, `IMAGE_TAG` or the three secret paths.

## Upgrade

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

From a checkout the order is the same: back up (step 1) before `git pull` and
`docker build -t qwbe-invoicing:local .`, because the rebuilt `local` tag is the new
version; then step 3, without `pull`. To keep the previous build for a rollback, tag
it first: `docker tag qwbe-invoicing:local qwbe-invoicing:previous`.

While the project is in development there is no upgrade path between schema
versions: each cube owns one baseline migration, and a changed baseline needs a new
database (README, "Schema during development"). `migrate` refuses a database whose
schema its history does not explain before writing anything, so `app` does not start
on it. This upgrade procedure applies once incremental migrations return after the
development stage. `doctor --json` is the readiness gate and reports
`pendingMigrations`, `migrationsReady` and `schemaDrift`. `artifacts` is a dry-run by
default and now reports both invoices and proformas missing PDFs; use `--apply`
(plus `--confirm-production` outside development) only to reconcile at most
`--limit` documents, one successful PDF at a time.

Never use `docker compose down -v` as an upgrade step — it deletes the named volume.

## Backup and restore (drill)

Backup reads the database and writes only the archive; repeating it produces the same contents. The archive holds `manifest.json`, a plain `pg_dump` of the one database as `database.sql` and the `/data/artifacts` tree, with a SHA-256 per member — therefore it includes proforma records/conversion metadata, proforma artifact metadata and proforma PDF files without a separate backup command or format. `browser_sessions` keeps its definition and loses its rows, so no live cookie survives a restore.

Both commands take the maintenance key EXCLUSIVE as a *try* and refuse immediately while `app` holds it SHARED: stop `app` first. Every `run` below carries `--no-deps`: `db` is already up, and without it Compose would also start the `migrate` service and change the schema of the database being backed up or restored. `restore --apply` executes `database.sql` through `psql` as the application role — only an archive you trust may be applied — and requires an **empty** target database: create a fresh one and point `PGDATABASE` at it. Nothing is ever dropped.

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
docker compose -f compose.prod.yaml exec db psql -U qwbe -d postgres \
  -c "CREATE DATABASE qwbe_invoicing_restored TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C' ENCODING 'UTF8'"
docker volume create qwbe-invoicing-data-restored
# Dry-run against that target: verifies the whole archive, writes nothing
docker compose -f compose.prod.yaml run --rm --no-deps -e PGDATABASE=qwbe_invoicing_restored \
  -v qwbe-invoicing-data-restored:/data -v /opt/qwbe-invoicing/backups:/backup app \
  node bin/qwbe-invoicing.ts restore --input /backup/qwbe-2026-08-31.tar.gz --json
# Apply
docker compose -f compose.prod.yaml run --rm --no-deps -e PGDATABASE=qwbe_invoicing_restored \
  -v qwbe-invoicing-data-restored:/data -v /opt/qwbe-invoicing/backups:/backup app \
  node bin/qwbe-invoicing.ts restore --input /backup/qwbe-2026-08-31.tar.gz --apply --confirm-production --json
# Point the stack at both (PGDATABASE and the data volume in compose.prod.yaml), then verify
docker compose -f compose.prod.yaml --profile proxy up -d
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts migrate --json
```

Separately protect `.env` (`PUBLIC_ORIGIN`, `ORGANIZATION_ID`, `IMAGE_TAG`), the contents of the four secret files, `Caddyfile`/`compose.prod.yaml` edits and `image-digests.txt` — they are operator config, not part of the data backup. A restored database needs the same `ORGANIZATION_ID`; sessions do not survive a restore, so users unlock again.

## Rollback

```bash
# 1. If the upgrade's `migrate` changed the schema, the previous image refuses it as
#    drift and `app` does not start: restore the backup taken in Upgrade step 1 into a
#    fresh database first (Backup and restore, above). An unchanged schema skips this.
# 2. Set IMAGE_TAG in .env back to the previous digest-pinned version (from the
#    previous image-digests.txt; from a checkout, the tag kept before the rebuild).
#    PUBLIC_ORIGIN and the secrets stay as they are.
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml --profile proxy up -d
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
```

If `app` does not become healthy, `docker compose -f compose.prod.yaml logs migrate` shows
why; a drift refusal there means step 1 was needed.

## Offline image bundle (optional)

```bash
docker save ghcr.io/<owner>/qwbe-invoicing:0.3.0 | gzip > qwbe-invoicing-0.3.0-image.tar.gz
# On the air-gapped host. Pin IMAGE_TAG=0.3.0 there: depending on the image store, a
# loaded image may not resolve by its registry digest, and Compose would try to pull.
gunzip -c qwbe-invoicing-0.3.0-image.tar.gz | docker load
```

## Security and audit notes

- Secrets are mounted from `${AUTH_TOKEN_PATH}`, `${PG_PASSWORD_PATH}` and `${COMPANY_LOOKUP_KEY_PATH}` as Compose secrets (`/run/secrets/*`), never baked into the image or printed; `scripts/init-secrets.sh` creates them and never prints or overwrites one. `doctor --json` reports only `authTokenReadable`, never the value.
- `issued_invoices`, `issued_lines`, `issued_tax_breakdown`, `proformas`, `proforma_lines`, `proforma_tax_breakdown`, legacy `proforma_conversions`, direct `proforma_invoice_conversions`, invoice/proforma artifact metadata, and document sequences are append-only or guarded by triggers — verified by current migrations and the boundary/size gates (`pnpm verify`). Direct mutation of an issued fiscal snapshot must fail with `issued invoices are immutable`; sealed proformas and both conversion audit records are likewise immutable.
- Keep invoice and proforma artifacts immutable: the PDF object key is `sha256/<2>/<64>.pdf` and reads verify key + digest + byte length. Proforma PDFs are marked `DOCUMENT NEFISCAL`; they carry no e-Factura, payment, or correction semantics and delivery means download, not email.
