# Local Docker development with Warden

The local hostname is `invoice.test`. Warden owns ports 80/443, local `.test` DNS,
and the development certificate authority. The application Compose project joins
the external `warden` Docker network; it does not publish an application port.

> Runtime: every request is an `Effect`. The standalone host authenticates (`Bearer` → `RequestContext`), injects `Clock`/`IdGenerator`/`TransactionalStore`, and runs the cube service `Effect` via `Effect.runPromise(Effect.either(...))`. Failures are typed (`ValidationFailure` → 400, `PermissionDenied` → 403, `ResourceNotFound` → 404, `DomainConflict` → 409).

## First setup on microq

```bash
pnpm local:setup             # dry-run
pnpm local:setup --apply     # starts Warden services and signs invoice.test once
mkdir -p .local && chmod 700 .local
openssl rand -hex 32 > .local/api-token && chmod 600 .local/api-token
docker compose build
docker compose up -d
docker compose ps
curl --fail --cacert ~/.warden/ssl/rootca/certs/ca.cert.pem https://invoice.test/health/ready
```

`migrate` runs once before `app` and initializes `/data/invoicing.sqlite` plus the
child documents cube database `/data/documents.sqlite`. SQLite is a standalone-host
choice: the QWBE mother has run one Postgres database with one schema per cube since
QWB-44, so nothing here describes mounted operation (see `FOUNDATION.md` section 18). Repeated `docker compose up -d`
is safe: both migration plans are idempotent and do not consume invoice numbers
or create business records. The API reads its standalone bearer
credential from the Compose secret; the secret is never stored in the image or
printed by the application. `ORGANIZATION_ID` selects the trusted organization for
this initial single-organization host adapter.

The standalone UI is available at `https://invoice.test/app` (also served from `/`). It is a React 19 + TypeScript application styled with Tailwind CSS 4 and built with Vite. Browser API calls, cancellation, concurrent invoice-detail loading and typed failures are Effect programs; TanStack Query bridges Effect programs into React server state. On unlock, the host exchanges the local bearer token for a revocable, opaque 30-day session persisted in `sessions.sqlite` and referenced by an HttpOnly `SameSite=Strict` cookie (`Secure` for HTTPS origins and in production). The token is never written to browser JavaScript, storage, or the URL. State-changing requests carry a per-session CSRF token held only in Effect memory; the UI restores it from the cookie-backed session after a reload or host restart.

After unlocking the UI, open `https://invoice.test/api` for the authenticated Swagger page. Its OpenAPI 3.1 document is generated from the same Effect `HttpApi` contract used to classify runtime routes; it is not a separately maintained endpoint list. The page stays behind the browser session so the full contract is not exposed anonymously.

Build the browser bundle locally with `pnpm build:ui`; `pnpm test` runs this build automatically before the Node test suite. Docker builds the UI in a dedicated stage and copies only `standalone/ui-dist` into the runtime image. CLI operations remain available when the ignored local bundle is absent; only UI requests return `503` with an explicit build instruction.

Every cube use-case is an `Effect` and has a 1:1 authenticated HTTP endpoint. Authenticated routes under `/api`:

- `GET /api/issuer` / `PUT /api/issuer` — read / configure issuer (Effect)
- `GET /api/document-series` / `POST /api/document-series` — list / register invoice or proforma series; exact duplicates return `409 document_series_exists`
- `POST /api/customers` / `GET /api/customers` / `GET /api/customers/:id` / `DELETE /api/customers/:id` — create / list / read / soft-delete optional customer records; `partyType=company` requires a valid CUI/CIF, while `partyType=individual` accepts an optional valid CNP; deletion hides the customer from new work while preserving issued invoice snapshots
- `POST /api/drafts` / `GET /api/drafts` / `GET|PUT|DELETE /api/drafts/:id` — create / list / read / edit / delete drafts; creation and update require exactly one of `customerId` (saved customer) or `customer` (one-time buyer snapshot), and `series` is mandatory and preconfigured as `invoice` on create
- `POST /api/drafts/:id/lines` / `PUT|DELETE /api/drafts/:id/lines/:lineId` — add / edit / remove manual invoice lines; no product catalog is required
- `POST /api/drafts/:id/issue` — atomically allocate the next number and freeze the immutable invoice snapshot; issued drafts can no longer be edited or deleted
- `GET /api/invoices` / `GET /api/invoices/:id` — latest 100 issued invoices / immutable issued snapshot (Effect)
- `POST /api/invoices/:id/pdf` (idempotent render) / `GET /api/invoices/:id/pdf` (download with SHA-256 ETag)
- `POST /api/invoices/:id/payments` (record payment) / `GET /api/invoices/:id/payments` (list payments with derived status `unpaid`/`partially_paid`/`paid`/`overpaid`/`overdue`, `paidAmount`/`remainingAmount`)
- `POST /api/invoices/:id/corrections` (storno fiscal — creează document nou imuabil cu referință la factura originală, motiv obligatoriu, totals negative) / `GET /api/invoices/:id/corrections` / `GET /api/corrections/:id` — după emitere nu se mai editează factura, doar storno
- Issued invoices have no `DELETE` endpoint and allocated invoice numbers are never reused; mistakes are handled through correction documents

Issued invoices remain immutable; payments are separate `Effect` records and never mutate the fiscal snapshot. For local calls, pass
`Authorization: Bearer $(cat .local/api-token)` and JSON request bodies. The bearer
adapter is the API-first standalone transport; the cube receives only the verified
identity and organization context.

Stop containers without deleting data:

```bash
docker compose down
```

Until the first real release, local development data is disposable and may be reset
deliberately. `docker compose down -v` still must not be used as an accidental or
routine stop command because `-v` deletes the SQLite volume.

## Laptop hosts and certificate trust

While the laptop is on the same LAN, add this line to its hosts file:

```text
10.10.1.30 invoice.test
```

When connecting over Tailscale instead, use:

```text
100.105.214.126 invoice.test
```

Copy the **public** Warden root CA from microq and trust it as a local development CA:

```text
/home/bogdan/.warden/ssl/rootca/certs/ca.cert.pem
```

Do not copy anything from `~/.warden/ssl/rootca/private/`. After the CA is trusted,
open `https://invoice.test`. The leaf certificate remains on microq and is served by
Warden Traefik.

## Operational checks

```bash
docker compose run --rm app node bin/qwbe-invoicing.ts migrate --json
docker compose exec app node bin/qwbe-invoicing.ts doctor --json
docker compose exec app node bin/qwbe-invoicing.ts artifacts --limit 50 --json
docker compose exec app node bin/qwbe-invoicing.ts artifacts --limit 50 --apply --json
docker compose logs --tail=100 app migrate
```

Migration and artifact reconciliation commands are dry-run unless `--apply` is
supplied. Artifact apply is bounded by `--limit`, commits successful PDFs one by one,
and can be rerun safely after partial failure. In non-development environments,
applying either operation also requires `--confirm-production`. PDFs are stored by
SHA-256 below `/data/artifacts`; reads verify key, digest, and byte length. The bundled
DejaVu Sans font supports Romanian glyphs and its distribution license is stored next
to the font in `standalone/assets/fonts/`.

`doctor` now reports `pendingMigrations`, `migrationsReady`, `organizationId`, `authTokenFile`/`authTokenReadable` and `nodeVersion` in addition to `writable`/`databaseReady`; it exits non-zero while any check fails so it can gate deployments. Liveness remains `GET /health/live` (process up); readiness is `GET /health/ready` (storage writable + migrations current) and drives the Dockerfile `HEALTHCHECK` and Compose readiness.

## Backup and restore

SQLite and artifacts are the durable state. Operator-provided configuration (`ORGANIZATION_ID`, `AUTH_TOKEN_FILE`), image digests and externally stored recovery secrets are **not** baked into the backup; include them separately in your runbook.

```bash
# Create a versioned archive (or directory) with manifest + SHA-256 verification
docker compose exec app node bin/qwbe-invoicing.ts backup --output /data/backup-2026-08-31.tar.gz --json
docker compose run --rm -v $(pwd)/.local/backup:/backup app node bin/qwbe-invoicing.ts backup --output /backup/qwbe-backup.tar.gz --json

# Dry-run restore — verifies manifest and lists files without writing
docker compose exec app node bin/qwbe-invoicing.ts restore --input /data/backup-2026-08-31.tar.gz --json

# Apply restore — idempotent, verifies SHA-256 before each write; outside development also requires --confirm-production
docker compose exec app node bin/qwbe-invoicing.ts restore --input /data/backup-2026-08-31.tar.gz --apply --json
docker compose exec app node bin/qwbe-invoicing.ts restore --input /backup/qwbe-backup.tar.gz --apply --confirm-production --json
```

`backup` is read-only and idempotent; repeated runs with the same `--output` overwrite atomically. `restore --apply` is idempotent — re-applying the same archive re-verifies each file via SHA-256 and is safe to retry after partial failure. In production, stop the `app` container before restore and run `doctor --json` + `migrate --json` after restore to confirm readiness. Never use `docker compose down -v` as a backup strategy; it deletes the named volume.

## Delivery (PDF download)

First usable release uses **PDF download** as the delivery channel (`GET /api/invoices/:id/pdf` with `ETag: "sha256-<digest>"`, `Content-Disposition: attachment` and `x-content-type-options: nosniff`). Email delivery is **deferred** per `PRODUCT.md` open decision #3 — PDF download alone satisfies the first slice; a future `email:send` permission and outbox will be added without changing the issuance snapshot.
