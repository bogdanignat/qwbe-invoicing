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
umask 077
openssl rand -hex 32 > .local/api-token
openssl rand -hex 32 > .local/pg-password        # the operator creates it; see below
chmod 600 .local/api-token .local/pg-password
docker compose build
docker compose up -d
docker compose ps
curl --fail --cacert ~/.warden/ssl/rootca/certs/ca.cert.pem https://invoice.test/health/ready
```

Both secrets are files the operator creates. Nothing in this repository holds a
credential, no default password exists, and the PostgreSQL password is never passed
as `PGPASSWORD`: the server reads it through `POSTGRES_PASSWORD_FILE` and the
application through `PGPASSWORD_FILE`, so it reaches neither a child process nor
`docker inspect`. Outside `development` a missing or empty password file is a refusal
to start, not a fallback. `.env.example` lists the paths and the volume names.

Persistence is a PostgreSQL 16 cluster in the `db` service — a container like
everything else here, pinned by digest, on its own named volume, with the cluster
initialised `--locale=C --encoding=UTF8` because the schema's indexes and keyset
cursors are written against binary text ordering. Its port is not published; only the
application network reaches it. PostgreSQL here is a standalone-host choice and the
mother's Postgres is a different database: `FOUNDATION.md` section 18 explains why
this still does not describe mounted operation.

Boot order is enforced by Compose, not by documentation: `db` healthy → `migrate`
completes successfully → `app` starts. `app` never migrates: it takes the maintenance
barrier SHARED and answers `503` on `/health/ready` and on every `/api` route until
the barrier, the schema and the artifact directory all agree. Repeated
`docker compose up -d` is safe: migration is idempotent and does not consume invoice
or proforma numbers or create business records. While the project is in development each
cube owns one baseline migration; a database created from an older baseline is refused
as drift and has to be recreated (README, "Schema during development"). The API reads its standalone bearer
credential from the Compose secret; the secret is never stored in the image or
printed by the application. `ORGANIZATION_ID` selects the trusted organization for
this initial single-organization host adapter.

The standalone UI is available at `https://invoice.test/app` (also served from `/`). It is a React 19 + TypeScript application styled with Tailwind CSS 4 and built with Vite. Browser API calls, cancellation, concurrent invoice-detail loading and typed failures are Effect programs; TanStack Query bridges Effect programs into React server state. On unlock, the host exchanges the local bearer token for a revocable, opaque 30-day session persisted in the `browser_sessions` table and referenced by an HttpOnly `SameSite=Strict` cookie (`Secure` for HTTPS origins and in production). The token is never written to browser JavaScript, storage, or the URL. State-changing requests carry a per-session CSRF token held only in Effect memory; the UI restores it from the cookie-backed session after a reload or host restart.

After unlocking the UI, open `https://invoice.test/api` for the authenticated Swagger page. Its OpenAPI 3.1 document is generated from the same Effect `HttpApi` contract served by `HttpApiBuilder`; it is not a separately maintained endpoint list. The page stays behind the browser session so the full contract is not exposed anonymously.

Build the browser bundle locally with `pnpm build:ui`; `pnpm test` runs this build automatically before the Node test suite. Docker builds the UI in a dedicated stage and copies only `standalone/ui-dist` into the runtime image. CLI operations remain available when the ignored local bundle is absent; only UI requests return `503` with an explicit build instruction.

Every cube use-case is an `Effect` and has a 1:1 authenticated HTTP endpoint. Authenticated routes under `/api`:

- `GET /api/issuer` / `PUT /api/issuer` — read / configure issuer (Effect)
- `GET /api/document-series` / `POST /api/document-series` — list / register invoice or proforma series; exact duplicates return `409 document_series_exists`
- `POST /api/customers` / `GET /api/customers` / `GET|PUT|DELETE /api/customers/:id` — create / list / read / edit / soft-delete optional customer records; `partyType=company` requires a valid CUI/CIF, while `partyType=individual` accepts an optional valid CNP; `defaultPaymentTermDays` is optional and prepopulates the due date when that customer is selected for a new document
- `GET|POST /api/product-presets` / `PUT|DELETE /api/product-presets/:id` — manage optional description-and-unit-price presets; selection copies values into an editable line and never creates a live product-to-invoice relation
- `POST /api/drafts` / `GET /api/drafts` / `GET|PUT|DELETE /api/drafts/:id` — create / list / read / edit / delete drafts; creation and update require exactly one of `customerId` (saved customer) or `customer` (one-time buyer snapshot), `series` is mandatory and preconfigured as `invoice` on create, and `dueDate` may be omitted or set to `null`
- `POST /api/drafts/:id/lines` / `PUT|DELETE /api/drafts/:id/lines/:lineId` — add / edit / remove invoice lines; manual authoring remains available without product presets
- `POST /api/drafts/:id/issue` — atomically allocate the next number and freeze the immutable invoice snapshot; issued drafts can no longer be edited or deleted
- `POST /api/invoices` — issue an invoice atomically from complete authoring content without first persisting a draft
- `GET /api/invoices` / `GET /api/invoices/:id` — latest 100 issued invoices / immutable issued snapshot (Effect)
- `GET /api/invoice-register` — read-only paged register combining issued invoices and storno documents; rows are discriminated by `kind`, retain stored signed totals, and corrections link to the organization-scoped original invoice. Invoice `dueDate` is nullable and `eFacturaStatus` is non-null; correction values are both `null`. It accepts the normal source filter and a dedicated keyset cursor; `/api/invoices` remains invoice-only
- `POST /api/invoices/:id/pdf` (idempotent render) / `GET /api/invoices/:id/pdf` (download with SHA-256 ETag)
- `POST /api/invoices/:id/payments` (record payment; requires `Idempotency-Key`) / `POST /api/invoices/:id/payments/:paymentId/reversal` (reverse one payment in full with an immutable counter-row; requires `Idempotency-Key`, optional `reason`) / `GET /api/invoices/:id/payments` (list payments with derived status `unpaid`/`partially_paid`/`paid`/`overpaid`/`overdue`, `paidAmount`/`remainingAmount`)
- `POST /api/invoices/:id/corrections` (storno fiscal — creează document nou imuabil cu referință la factura originală, motiv obligatoriu, totals negative) / `GET /api/invoices/:id/corrections` / `GET /api/corrections/:id` — după emitere nu se mai editează factura, doar storno
- Issued invoices have no `DELETE` endpoint and allocated invoice numbers are never reused; mistakes are handled through correction documents

T-1069 proforma route inventory (seven authenticated routes):

- `POST /api/proformas` — emit an immutable proforma directly from complete authoring content; no draft is persisted
- `POST /api/drafts/:draftId/proformas` — emit an immutable proforma from the editable draft, using the requested configured proforma series
- `GET /api/proformas` — list proformas
- `GET /api/proformas/:id` — read proforma detail, including conversion state
- `POST /api/proformas/:id/invoice` — issue exactly one immutable invoice directly from the preserved proforma snapshot and allocate its invoice number atomically
- `POST /api/proformas/:proformaId/pdf` — idempotently render the proforma PDF
- `GET /api/proformas/:proformaId/pdf` — download the proforma PDF

The original direct draft-to-invoice route remains available. Invoice numbers are
allocated only by invoice issuance, through `POST /api/invoices`, `POST /api/drafts/:id/issue`,
or `POST /api/proformas/:id/invoice`. Invoice and proforma series use
separate configured sequence scopes, and neither kind reuses allocated numbers.
`dueDate` is nullable on draft, proforma, and invoice responses; without one, an
invoice is not `overdue` from the calendar date alone. Proformas have list/detail/PDF
support, but no e-Factura, payment, overdue, or correction/storno semantics. Their PDF
is conspicuously marked `DOCUMENT NEFISCAL`.

Issued invoices remain immutable; payments are separate `Effect` records and never mutate the fiscal snapshot. For local calls, pass
`Authorization: Bearer $(cat .local/api-token)` and JSON request bodies. The bearer
adapter is the API-first standalone transport; the cube receives only the verified
identity and organization context.

Stop containers without deleting data:

```bash
docker compose down
```

Until the first real release, local development data is disposable and may be reset
deliberately. The `-v` form of `down` still must not be used as an accidental or
routine stop command: it deletes the PostgreSQL cluster volume, the artifact volume
and the backup staging volume in one go.

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
supplied. Artifact reconciliation covers both invoices and proformas. Apply is
bounded by `--limit`, commits successful PDFs one by one,
and can be rerun safely after partial failure. In non-development environments,
applying either operation also requires `--confirm-production`. PDFs are stored by
SHA-256 below `/data/artifacts`; reads verify key, digest, and byte length. The bundled
DejaVu Sans font supports Romanian glyphs and its distribution license is stored next
to the font in `standalone/documents/assets/fonts/`.

`doctor` reports `database` (host, port, database, user — never the password),
`databaseReady`, `pendingMigrations`, `migrationsReady`, `schemaDrift`,
`organizationId`, `authTokenFile`/`authTokenReadable`, `nodeVersion` and `writable`;
it exits non-zero while any check fails so it can gate deployments. Liveness remains
`GET /health/live` (process up, answered without touching the database, so it stays
200 under saturation); readiness is `GET /health/ready` (maintenance barrier held,
artifact directory present and writable — observed, never created, so a missing
`DATA_DIR` keeps readiness at 503 and `doctor` at exit 1 — and the live schema matching the recorded migration
history), single-flight and cached for 5 seconds, and drives the Dockerfile
`HEALTHCHECK` and Compose readiness.

`migrate --apply` takes the maintenance barrier EXCLUSIVE with a bounded try, so
running it while `app` is up is refused at once instead of hanging. The dry run
(`migrate --json`, no `--apply`) never takes the barrier and is safe at any time:

```text
the maintenance barrier is held by another session after 10 attempts (3000ms):
the application is running, stop it before migrating
```

Stop the application first (`docker compose stop app`), migrate, then start it again.

## Backup and restore

The PostgreSQL database and the artifact tree are the durable state. An archive holds
`manifest.json`, `database.sql` (a plain `pg_dump` of the whole database) and
`artifacts/sha256/<2 hex>/<64 hex>.pdf` — nothing else is a member — so invoices,
proformas, conversion metadata, artifact metadata and the PDFs travel together.
`browser_sessions` is dumped without its rows (`--exclude-table-data`): the table
definition stays, so the restored schema does not drift, but no live session is
carried over. Operator-provided configuration (`ORGANIZATION_ID`, `AUTH_TOKEN_FILE`,
the two secret files), image digests and externally stored recovery secrets are
**not** in the backup; include them separately in your runbook.

Staging is a volume, not RAM: `TMPDIR` is `/var/backups/staging` inside the container
and `/tmp` is a bounded tmpfs, because the archive bounds allow a 1 GiB expanded tree.

Both commands require the application to be stopped. They take the same maintenance
key EXCLUSIVE that `app` holds SHARED for the life of its process, as a *try*: a
refusal is immediate, because a maintenance command that blocks behind a healthy
application looks like a hang.

```bash
docker compose stop app

# Create a versioned archive (or directory) with manifest + SHA-256 verification
docker compose run --rm app node bin/qwbe-invoicing.ts backup --output /data/backup-2026-08-31.tar.gz --json
docker compose run --rm -v $(pwd)/.local/backup:/backup app node bin/qwbe-invoicing.ts backup --output /backup/qwbe-backup.tar.gz --json

# Dry-run restore — validates the whole archive and reports the target, writing nothing
docker compose run --rm app node bin/qwbe-invoicing.ts restore --input /data/backup-2026-08-31.tar.gz --json

# Apply restore — only into a fresh, empty database and an empty artifact tree;
# outside development it also requires --confirm-production
docker compose run --rm app node bin/qwbe-invoicing.ts restore --input /data/backup-2026-08-31.tar.gz --apply --json

docker compose start app
```

With `app` still running, both refuse and do nothing:

```text
backup requires the application to be stopped: the maintenance lock is held
(2 application backends connected). Nothing was read or written.
```

`backup` is read-only with respect to the database and refuses a destination that
already exists, so a ten-minute dump cannot half-overwrite an older backup. It
cross-checks the archive against the database — every `invoice_artifacts` /
`proforma_artifacts` row must have its PDF present with the digest the row claims —
and re-reads and fsyncs the finished archive before reporting success.

`restore --apply` is **not** idempotent and is not a resume: it only ever writes into
an empty database and an empty artifact tree, and a populated target is a refusal with
an instruction, never a deletion.

```text
restore requires an empty database; this one already holds objects (relations=27
routines=7). Create a fresh database and restore into that; nothing is dropped here.
```

Artifacts are copied first and the SQL goes in last as one
`psql --single-transaction` transaction, so the commit is the only point after which
rows can reference PDFs. A failure before it leaves an empty database.

`database.sql` is **executed** as the application's own database role, and the
archive's checksums live inside the archive: they prove integrity, never authenticity.
`restore --apply` therefore prints the trust boundary on stderr before it writes —
`--json` consumers keep a clean stdout — and the rule is to restore only from a source
trusted as much as the database itself. There is no signature and no key management.

Afterwards run `doctor --json` and `migrate --json` to confirm readiness. Never treat
`down` with `-v` as a backup strategy; it deletes the named volumes.

## Delivery (PDF download)

First usable release uses **PDF download** as the delivery channel (`GET /api/invoices/:id/pdf` or `GET /api/proformas/:proformaId/pdf`, with `ETag: "sha256-<digest>"`, `Content-Disposition: attachment` and `x-content-type-options: nosniff`). Email remains a future capability; downloading the conspicuously non-fiscal proforma PDF is delivery, not an email action. A future `email:send` permission and outbox can be added without changing immutable document snapshots.
