# QWBE Invoicing

**Self-hosted invoicing for Romania.** Issues, preserves, corrects and tracks payment of
Romanian invoices (facturi) and non-fiscal proformas under Romanian fiscal rules: document
series with sequential numbering, CUI/CIF validation, VAT per line, immutable issued
documents, and correction by storno instead of editing.

Jurisdiction and currency are fixed to Romania (`RO`) and Romanian leu (`RON`) in the first
release. The data model is being prepared for RO e-Factura (EN 16931 / RO CIUS), but this version
does **not** submit invoices to ANAF yet. See [What it does not do yet](#what-it-does-not-do-yet).

The product and engineering baseline is [`PRODUCT.md`](./PRODUCT.md), the architecture is
[`FOUNDATION.md`](./FOUNDATION.md). This page is the short version: what it is, how it
works, how to install and run it.

## Contents

- [Who it is for](#who-it-is-for)
- [What it does](#what-it-does)
- [What it does not do yet](#what-it-does-not-do-yet)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Data, backup and restore](#data-backup-and-restore)
- [Upgrading](#upgrading)
- [API](#api)
- [CLI](#cli)
- [Security model](#security-model)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Relation to QWBE](#relation-to-qwbe)
- [Documents](#documents)
- [License](#license)

## Who it is for

A Romanian legal entity that wants to run its own invoicing on its own server, with its
own database, without a SaaS in between. One installation serves one organization in the
first release; the domain is organization-scoped so more legal entities can follow without
a rewrite.

## What it does

- **Issuer profile**: legal name, CUI/CIF, VAT id, trade register id, structured address,
  IBAN and bank, VAT regime, PNG/JPEG logo and/or custom brand text, default payment terms and notes.
  Branding is optional and configured in **Date firmă**: PNG or JPEG up to 256 KiB,
  2048 px per axis / 4 megapixels, and plain text up to 80 Unicode characters.
  Images are validated server-side and normalized to metadata-free PNG (also bounded
  to 256 KiB); SVG, animated images and external image URLs are not accepted.
  Drafts show the current brand; issued invoices and proformas freeze it in their
  issuer snapshot and PDF, including proforma-to-invoice conversion. Document lists
  omit branding images. Legal issuer details remain independent of the brand.
  The issuer must explicitly select **SRL** or **PFA**. `PUT /api/issuer` requires
  `legalForm` (`srl`/`pfa`) and the string keys `tradeRegistryNumber`, `socialCapital`,
  `iban`, `bankName`; empty strings allow an incomplete profile to be saved.
  Issuing either invoices or proformas requires a trade register number for both
  forms (a product rule for PFA), and social capital for SRL. IBAN and bank are optional.
  Capital is exact nonnegative RON text: at most 18 integer digits and two decimals,
  normalized to two decimal places without floating-point conversion. This is not
  a check of statutory minimum capital. RegCom validation accepts legacy and current
  ONRC shapes, not registry existence; IBAN validation checks structure, mod-97 and
  the Romanian 24-character length, not account existence or a complete foreign-country registry.
  These values are frozen into documents and retained in summaries, conversions and
  corrections; PDF and UI omit empty optional lines. Existing cached PDFs are not
  regenerated merely because a template version changes.
  Databases created from an older schema are not backfilled; they are recreated
  (see "Schema during development" below).
- **Customers** (optional register): companies with a valid CUI/CIF, or natural persons with
  an optional CNP. A document can also be issued to a one-time buyer typed directly in the
  editor, so the register and draft persistence are conveniences, not prerequisites. A saved
  customer may define a default payment term which prepopulates, but never locks, the due date.
- **Products and services** (optional presets, the "Catalog" screen): a short reusable list of
  descriptions, units of measure and unit prices. Selecting one copies those values into an editable invoice line; there is no stock,
  SKU, price-list logic, or live relation to the saved preset. A product may also prefer a VAT
  rate, stored as a code (`RO_STANDARD`, `RO_REDUCED`) rather than a percentage, so a legal rate
  change needs no product edit. The line gets that code only when the issuer can charge it on
  the document date; otherwise, and always for an Article 310 issuer, it gets the issuer's default
  (see `docs/VAT_TREATMENT.md`, "Preferred VAT rate on a product").
- **Document series**: separate series for invoices and proformas. Numbers are allocated
  atomically at issue time, are unique within their scope and are never reused. Uniqueness
  is enforced by the database, not only by the UI.
- **Drafts**: editable, with manual lines (name, quantity, unit, unit price, VAT category and
  rate, allowances and charges), references (contract, order, delivery, preceding document),
  notes and payment terms. Drafts do not consume numbers. Product presets are never required.
- **Issuing**: one atomic operation that validates the authored document, allocates the next number,
  freezes the totals and snapshots issuer, buyer, lines and tax breakdown. From then on the
  invoice is an immutable fiscal document. Later changes to the customer or issuer never
  alter it.
- **PDF**: rendered from the snapshot, stored by SHA-256 with template version and
  timestamp, downloadable with an ETag. The bundled DejaVu Sans font covers Romanian
  diacritics.
- **Proformas**: immutable, numbered, conspicuously marked `DOCUMENT NEFISCAL`, and invoiceable
  exactly once into an immutable fiscal snapshot. A proforma never consumes an invoice number;
  the resulting invoice receives its number atomically when issued.
- **Payments**: separate records allocated to invoices, with derived states `unpaid`,
  `partially_paid`, `paid`, `overpaid` and `overdue`. Payments never mutate the invoice.
- **Corrections (storno)**: an issued invoice is corrected by a new immutable document that
  references the original, with a mandatory reason. There is no delete for issued invoices.
- **Operations**: idempotent migrations, a `doctor` health report, artifact reconciliation,
  versioned backup with verified restore, liveness and readiness endpoints.

## What it does not do yet

- **No RO e-Factura submission.** Taxpayers under the e-Factura obligation need another
  compliant channel for XML submission until the ANAF integration ships. A PDF is a visual
  representation, not the structured XML the law requires.
- No simplified invoice, delivery note, receipt or fiscal receipt.
- No email delivery. Delivery means PDF download.
- No foreign issuers, foreign billing addresses or invoices in other currencies.
- One organization per installation.

This repository is not legal or tax advice. Special VAT regimes, cross-border transactions,
cash-register rules and sector-specific obligations must be validated with an accountant.

## How it works

One application process, one PostgreSQL 16 server, one data directory for the PDFs.

```text
browser ──> /app  (React UI)  ──┐
                                 ├──> standalone host ──> invoicing core ──> PostgreSQL 16
API client ──> /api (Bearer) ───┘        │                                    one database, schema `public`
                                          └──> PDF renderer ──> /data/artifacts/<sha256>
```

- **The core** (`cube/invoicing`) holds the domain model, VAT arithmetic, date
  validation, the store ports and the idempotency rules, and composes the service from its
  components. It knows nothing about HTTP, the database or the browser. It depends only on a small
  set of host contracts (`cube/invoicing/contracts/host.ts`): who is calling and for which
  organization, a clock, an id generator, a transactional store and a renderer.
- **The component cubes** under `cube/invoicing/` each own one piece of the logic and share
  the parent's domain: `parties` (the Romanian fiscal rules for every party: CUI, CNP,
  counties and sectors), `customers` (saved customers, with their own table and baseline),
  `catalog` (saved products and services and the unit-of-measure list they are chosen from,
  with their own table and baseline), `issuer` (issuer profile, branding and VAT
  configurations and their own tables and baseline), `drafts`
  (authoring a document, draft and line editing), `issuance` (numbered invoices and
  proformas, document series, conversion, idempotent replay), `corrections` (storno) and `documents`
  (rendered PDF artifacts, their hashes and recovery). A child enters another child only
  through its `index.ts`.
- **The standalone host** (`standalone/`) is the composition root. It authenticates the
  request, provides the contracts above, exposes every use case as an HTTP endpoint, serves
  the UI, runs migrations and implements the CLI.
- **Every request is an `Effect` program** with typed failures, mapped to HTTP status codes:
  validation `400`, permission `403`, not found `404`, conflict `409`.
- **The OpenAPI document is generated** from the same contract that serves the routes, so
  the Swagger page never drifts from the running server.

Issuing an invoice, step by step: validate the draft and the caller's permission, allocate
the next number of the selected series inside the same transaction, calculate and freeze the
monetary and tax totals, snapshot issuer, buyer, lines and tax breakdown, persist the issued
invoice and its lifecycle event, then render and store the PDF. If any step fails, nothing
is written and no number is lost.

## Requirements

| | |
|---|---|
| Runtime | Docker Engine with Docker Compose v2 (recommended), or Node 24.19, pnpm 11 and a PostgreSQL 16 server for a bare install |
| Database | PostgreSQL major 16 exactly, cluster locale `C`, encoding `UTF8`; the bundle ships `postgres:16-alpine` and `backup` refuses any other major |
| Architecture | `linux/amd64` or `linux/arm64` images on GHCR |
| Storage | one volume for the PostgreSQL cluster and one writable volume for the PDFs; a few hundred MB is plenty for years of invoices |
| Network | the app listens on port `3000` inside the container; put a TLS reverse proxy in front (a Caddy profile is included) |
| Secrets | two files, generated by you and mounted as Docker secrets: the API token and the database password |

## Installation

The supported way is the versioned Docker Compose bundle. Each release ships
`compose.prod.yaml`, `.env.example`, `Caddyfile.example`, `image-digests.txt` and the docs.
Images live at `ghcr.io/bogdanignat/qwbe-invoicing:<version>`.

```bash
# 1. Data and secret locations on the host. Two secrets: the API token and the
#    database password. Both are files, never environment variables.
mkdir -p /opt/qwbe-invoicing/secrets && chmod 700 /opt/qwbe-invoicing/secrets
openssl rand -hex 32 > /opt/qwbe-invoicing/secrets/api-token
openssl rand -hex 32 > /opt/qwbe-invoicing/secrets/pg-password
chmod 600 /opt/qwbe-invoicing/secrets/api-token /opt/qwbe-invoicing/secrets/pg-password

# 2. The bundle
cp compose.prod.yaml Caddyfile.example /opt/qwbe-invoicing/
cp .env.example /opt/qwbe-invoicing/.env
cd /opt/qwbe-invoicing
# edit .env: IMAGE_TAG, ORGANIZATION_ID, AUTH_TOKEN_PATH, PG_PASSWORD_PATH, APP_DOMAIN
# (see Configuration; AUTH_TOKEN_PATH and PG_PASSWORD_PATH have no fallback)

# 3. Optional TLS: copy Caddyfile.example to Caddyfile and set your domain

# 4. Start. `db` comes up first and must report healthy, then `migrate` runs;
#    `app` starts only if migrations succeed. The cluster is created at first
#    start with locale C and encoding UTF8.
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml up -d
# with TLS:
docker compose -f compose.prod.yaml --profile proxy up -d

# 5. Verify
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/ready
```

Then open `https://<your-domain>/app`, unlock the UI with the API token, and configure the
issuer and the first invoice series.

What the bundle enforces: the application container runs as a non-root user with a
read-only root filesystem and a bounded `tmpfs` on `/tmp`; named volumes
`qwbe-invoicing-data` on `/data`, `qwbe-invoicing-postgres` for the cluster and
`qwbe-invoicing-backup-staging` for `TMPDIR`; the database publishes no port and is
reachable only on the application network; the API token and the database password come
from file-based secrets and are never in the image, the environment or the logs; `app`
depends on `db` being healthy and on `migrate` completing successfully; the health check
hits `/health/ready`.

For a local development setup with Docker Compose see
[`docs/LOCAL_DEVELOPMENT.md`](./docs/LOCAL_DEVELOPMENT.md). For a bare-metal run without
Docker: `pnpm install`, `pnpm build:ui`, then `node bin/qwbe-invoicing.ts migrate --apply`
and `node bin/qwbe-invoicing.ts serve` with the variables below set, against a PostgreSQL 16
database that already exists and whose role owns it.

## Configuration

Everything is configured through environment variables, read once at startup.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port inside the container |
| `HOST` | `0.0.0.0` | bind address |
| `DATA_DIR` | `/data` | directory holding the `artifacts/` tree of rendered PDFs; it must already exist as a real directory (not a symlink) and be writable — the application never creates it: readiness and `doctor` report it missing, and `artifacts`/`backup`/`restore` refuse to run |
| `PGHOST` | `db` | PostgreSQL host |
| `PGPORT` | `5432` | PostgreSQL port |
| `PGDATABASE` | `qwbe_invoicing` | the one database this installation owns |
| `PGUSER` | `qwbe` | the role that owns the schema |
| `PGPASSWORD_FILE` | none | path to the file holding the database password; required outside development, never read from `PGPASSWORD` |
| `NODE_ENV` | `development` | `production` requires `--confirm-production` on destructive CLI operations and marks cookies `Secure` |
| `ORGANIZATION_ID` | none | the legal entity this installation serves; every record is scoped to it |
| `AUTH_TOKEN_FILE` | none | path to the file holding the API bearer token (the Compose secret mounts it at `/run/secrets/api_token`) |

Variables used only by the Compose files, in `.env`:

| Variable | Meaning |
|---|---|
| `IMAGE_TAG` | image version, ideally digest-pinned from `image-digests.txt`, e.g. `0.3.0@sha256:<digest>` |
| `AUTH_TOKEN_PATH` | host path of the token file mounted as the secret |
| `APP_DOMAIN` | domain served by the optional Caddy proxy |
| `DATA_VOLUME_NAME` | name of the data volume, default `qwbe-invoicing-data` |
| `PG_PASSWORD_PATH` | host path of the database password file, mounted as a secret into both `db` and the application (required, no fallback) |
| `PG_VOLUME_NAME` | name of the cluster volume, default `qwbe-invoicing-postgres` |
| `BACKUP_STAGING_VOLUME_NAME` | name of the `backup`/`restore` staging volume, default `qwbe-invoicing-backup-staging` |

## Data, backup and restore

Durable state lives in two places:

```text
PostgreSQL `qwbe_invoicing`, schema `public`
                          issuer, customers, catalog, series, drafts, invoices, proformas,
                          payments, corrections, artifact metadata, audit events,
                          browser_sessions (rows excluded from every backup)
/data/artifacts/          PDFs stored by SHA-256
```

Back up with the CLI, not by copying the cluster directory, and with the application
stopped: `backup` and `restore` take the maintenance key EXCLUSIVE as a *try*, so both
refuse immediately while `app` holds it SHARED.

```bash
docker compose -f compose.prod.yaml stop app
docker compose -f compose.prod.yaml run --rm app \
  node bin/qwbe-invoicing.ts backup --output /data/backup-$(date +%F).tar.gz --json
docker compose -f compose.prod.yaml start app
```

The archive holds `manifest.json`, a plain `pg_dump` of the database as `database.sql` and
the artifact tree, with a SHA-256 per member and the `pg_dump`/`psql` versions and the
applied migrations recorded. A backup whose database references a PDF missing from
`DATA_DIR`, or whose digest differs from the stored row, is refused rather than written.

`restore --input <archive>` is a dry-run that verifies the whole archive and reports the
target. `restore --input <archive> --apply` writes the artifacts and executes
`database.sql` through `psql` **as this application's role**, so only an archive you trust
may be applied: the manifest digests prove integrity, never authenticity. It requires an
empty target database — create a fresh database and restore into that; nothing is ever
dropped — and outside development it also requires `--confirm-production`. Run
`doctor --json` and `migrate --json` afterwards. `docker compose down -v` deletes both the data and
the cluster volume and is never a backup strategy.

## Upgrading

```bash
cd /opt/qwbe-invoicing
IMAGE_TAG=0.4.0@sha256:<new-digest> docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml stop app
docker compose -f compose.prod.yaml run --rm app \
  node bin/qwbe-invoicing.ts backup --output /data/backup-$(date +%F).tar.gz --json
IMAGE_TAG=0.4.0@sha256:<new-digest> docker compose -f compose.prod.yaml up -d
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
```

Migrations are applied by the `migrate` service on startup and are idempotent: they never
consume invoice or proforma numbers and never create business records. Rollback: restore
the backup taken before the upgrade, then start the previous image. The full procedure is in
[`docs/RELEASE.md`](./docs/RELEASE.md).

## API

Authenticated routes live under `/api` and require `Authorization: Bearer <token>`.
The Swagger page is at `/api` (behind the browser session) and the OpenAPI 3.1 document is
generated from the same Effect `HttpApi` contract served by `HttpApiBuilder`.
The builder handles routing, decoding and response encoding; input errors retain
the existing `400 ValidationFailure` envelope. The server disposes its Effect
handler on shutdown.

| Area | Routes |
|---|---|
| Issuer | `GET`, `PUT /api/issuer` |
| VAT catalogue | `GET /api/vat-regimes` |
| Series | `GET`, `POST /api/document-series` |
| Customers | `GET`, `POST /api/customers`, `GET`, `PUT`, `DELETE /api/customers/:id` |
| Product presets | `GET`, `POST /api/product-presets`, `PUT`, `DELETE /api/product-presets/:id` |
| Drafts | `GET`, `POST /api/drafts`, `GET`, `PUT`, `DELETE /api/drafts/:id`, lines under `/api/drafts/:id/lines` |
| Issue | `POST /api/invoices`, `POST /api/drafts/:id/issue` |
| Invoices | `GET /api/invoices`, `GET /api/invoices/:id`, `POST`, `GET /api/invoices/:id/pdf` |
| Invoice register | `GET /api/invoice-register` — paged invoices and storno documents |
| Payments | `GET`, `POST /api/invoices/:id/payments`, `POST /api/invoices/:id/payments/:paymentId/reversal` |
| Corrections | `GET`, `POST /api/invoices/:id/corrections`, `GET /api/corrections/:id` |
| Proformas | `POST /api/proformas`, `POST /api/drafts/:id/proformas`, `GET /api/proformas`, `GET /api/proformas/:id`, `POST /api/proformas/:id/invoice`, `POST`, `GET /api/proformas/:id/pdf` |
| Health | `GET /health/live`, `GET /health/ready` (no auth) |

Issuer configuration accepts `vatChange: { registered, effectiveFrom }` for VAT
registration, or `{ registered: false, effectiveFrom, nonVatBasis: "article_310" }`
for the supported small-business exemption. The UI generates this basis automatically
from the existing non-VAT registration setting; no second selection is required.
`nonVatBasis` is forbidden
when `registered` is true. These commands are accepted instead
of a caller-authored `vatConfigurations` history. The server builds that history
and returns it with `currentVat` (null when no registration is currently active).
The catalogue supplies date-effective line rates separately from issuer registration.
CUI is stored as canonical digits without `RO`; VAT registration is explicit, never
inferred from a prefix. The UI may strip a typed `RO` prefix without changing the
registration checkbox. Company buyers also carry an explicit `vatRegistered` flag;
individual buyers must use `false` and may omit their CNP (empty identifier).
Issued snapshots preserve both parties' VAT status. UI/PDF derive a registered
party's VAT identifier as `RO` + CUI without consulting the current registry.
Addresses require one of the 42 Romanian ISO 3166-2 county codes. `RO-B` requires
an integer sector from 1 to 6; other counties prohibit a sector.
Positive invoices require `dueDate` before a number is allocated, including draft
issuance and proforma conversion. Drafts, proformas and zero invoices may omit it.
Draft issuance rejects stale VAT without consuming a document number; saving a
stale draft refreshes affected lines even when their VAT code is unchanged. Issued
documents, external snapshots and proforma conversions retain their frozen values.

The invoice public contract owns these immutable fiscal facts; the future e-Factura
exporter must not reconstruct them from current profiles or private database tables.
Line/configuration/breakdown snapshots include `vatCategoryCode` and
`vatExemptionReason`: `S` for positive standard/reduced rates (reason `null`),
`E` at `0.00` for Article 310, with the frozen legal reason text.
The application supports Article 310 for its non-VAT issuer workflow and generates
the associated metadata automatically; other exemptions and categories O/Z/AE are
not supported. This bounded product rule is not an external fiscal-status lookup.
See [the fiscal treatment contract and evidence](docs/VAT_TREATMENT.md).
Readiness is **not complete**: no UBL/XML export, complete CIUS-RO validation or
ANAF transport is included in this lot.

Numbered invoices, proformas and corrections expose a trusted `actorId`. Their
issuance, issuer/series configuration, payments and reversals append fiscal events
inside the business transaction; idempotent retries do not append duplicates.
`audit_events` rejects updates/deletes. There is no audit browsing endpoint yet.
Payments remains a separate cube with `payments:*` permissions; recording a payment
is optional and is not required to issue an invoice. Document/PDF metadata and browser
sessions are owned by their own scopes and tables inside the one database, and
`eFacturaStatus` is retained.

**Schema during development:** one database holds every scope, so the ledger key is
`(scope, name)`. Each cube owns one baseline migration holding the current definition
of its tables, and they run in dependency order after the foundation — eight ledger
entries in total: `foundation/000-foundation`, `customers/customers-001-baseline`,
`catalog/catalog-001-baseline`, `issuer/issuer-001-baseline`,
`invoicing/invoicing-001-baseline`, `payments/payments-001-baseline`,
`documents/documents-001-baseline` and the host's own
`standalone/000-browser-sessions`. Customers and issuer precede invoicing because it
references them. A schema change edits the owning baseline, so a database created
before it no longer matches: `migrate` refuses it before writing anything and `doctor`
reports it, both naming the drifted objects and asking to recreate the database.
Recreating is not an upgrade: it drops the local data, and the migrator never drops a
database on its own. Prefer a new database — `CREATE DATABASE` with `TEMPLATE
template0 LC_COLLATE 'C' LC_CTYPE 'C' ENCODING 'UTF8'`, point `PGDATABASE` at it and
use a fresh `DATA_DIR` — otherwise stop the application and drop and recreate the
database explicitly, keeping the secret files. Then run `migrate --json`,
`migrate --apply --json`, a repeated dry-run and `doctor --json`. There is no backfill
and no legacy-snapshot fallback.

Registries (`GET /api/customers`, `/api/product-presets`, `/api/drafts`, `/api/invoice-register`, `/api/invoices`, `/api/proformas`)
are paged: the response is `{ "items": [...], "nextCursor": "..." | null }`, `?limit=` takes 1 to 200
(default 100) and `?cursor=` repeats the previous `nextCursor`. Documents are ordered by issue date,
number and id, registries by name and id, so a cursor stays valid while new records arrive.

`GET /api/invoice-register` is the read-only mixed fiscal register; `GET /api/invoices`
keeps its invoice-only contract. Every row has `kind`, its own `id`, series, number,
issue date, customer name, currency and stored total. Invoice rows expose nullable
`dueDate` and their non-null `eFacturaStatus`, and omit `originalReference`. Correction
rows retain their negative total, expose `dueDate: null`, `eFacturaStatus: null`, and
reference the organization-scoped original invoice by id, series and number. The mixed
register uses a dedicated opaque cursor that also contains `kind`; invoice-list cursors
are rejected rather than interpreted in a different ordering.

Issued invoices have no `DELETE`. Mistakes are handled through correction documents, which are
numbered in the invoice series like any other invoice (Codul fiscal art. 330). Issue dates cannot be
in the future or before the last document numbered in the same series and fiscal year, and an invoice
issued from a proforma is dated on the day of conversion (art. 319 (20) b) with the proforma's payment
term carried over.
The complete route inventory with request rules is in
[`docs/LOCAL_DEVELOPMENT.md`](./docs/LOCAL_DEVELOPMENT.md).

## CLI

```bash
node bin/qwbe-invoicing.ts serve
node bin/qwbe-invoicing.ts migrate   [--apply] [--confirm-production] --json
node bin/qwbe-invoicing.ts doctor    --json
node bin/qwbe-invoicing.ts artifacts --limit 50 [--apply] [--confirm-production] --json
node bin/qwbe-invoicing.ts backup    --output <file.tar.gz> --json
node bin/qwbe-invoicing.ts restore   --input  <file.tar.gz> [--apply] [--confirm-production] --json
```

Migration, artifact reconciliation and restore are dry-run unless `--apply` is given, and
outside development also require `--confirm-production`. `doctor` reports the artifact
directory, the connection (host, port, database, user — never the password), the ledger,
pending migrations, schema drift, organization, token file and Node version, and exits
non-zero while any check fails, so it can gate a deployment. `serve` never migrates: it
takes the maintenance key SHARED, listens regardless, and answers `503` on
`/health/ready` and `/api*` until the barrier, the schema and the artifact directory all
agree. `backup` and `restore` take that same key EXCLUSIVE as a *try*, so both refuse
immediately while `serve` is running, and `restore --apply` additionally requires an
empty target database.

## Security model

- The single API token is the shared owner/admin credential for the installation. Every
  holder receives owner access as actor `standalone-owner`; standalone mode has no users or
  separate authorization levels yet. The token is read from a file, never printed and never
  stored in the image. Rotate it by replacing the secret file and restarting the process;
  the changed credential hash invalidates existing browser sessions.
- The browser UI exchanges the token once for a revocable, opaque 30-day session held in an
  `HttpOnly`, `SameSite=Strict` cookie (`Secure` under HTTPS and in production). The token
  never reaches browser JavaScript, storage or the URL. State-changing requests carry a
  per-session CSRF token.
- Failed browser unlocks and failed Bearer authentication are throttled in memory by the
  normalized direct socket peer address; forwarded headers are not trusted. The protection
  is instance-local. The first five failures have no cooldown; from the sixth failure,
  cooldowns are 1, 2, 4, 8, 16 and then at most 30 seconds.
  Entries expire after 15 minutes of inactivity, are capped at 10,000 with LRU eviction and
  reset on process restart; successful authentication resets the peer entry. Cookie-session
  requests are unaffected. Valid traffic is unaffected in normal state, but a valid Bearer
  request can receive `429 {"error":"too_many_attempts"}` with `Retry-After` while its shared
  peer is cooling down.
- NATs and proxies aggregate callers under one peer, creating an explicit risk of temporary
  shared lockout; there is no trusted-proxy configuration. Throttle logs contain neither
  secrets nor raw IP addresses and emit at most once per key per cooldown interval. This is
  login-throttling, not complete DDoS protection; enforce broad request-rate and network
  controls at the reverse proxy.
- Issued documents are immutable; PDFs are content-addressed and verified on read.
- The container is read-only and non-root. TLS and network exposure are the
  reverse proxy's job; the included Caddy profile sets HSTS and the usual hardening headers.

## Repository layout

```text
cube/invoicing/            core: domain model, VAT arithmetic, ports, contracts, migrations, service composition
cube/invoicing/parties/    component: CUI, CNP, counties and sectors shared by issuer and buyers
cube/invoicing/customers/  component: saved customers, their table and baseline migration
cube/invoicing/catalog/    component: saved products and services, their table and baseline migration
cube/invoicing/issuer/     component: issuer profile, branding, VAT configurations and baseline
cube/invoicing/drafts/     component: document authoring, draft and line editing
cube/invoicing/issuance/   component: document series, numbered invoices and proformas, conversion, idempotent replay
cube/invoicing/corrections/ component: correction documents (storno)
cube/invoicing/documents/  component: rendered PDFs and artifact recovery
cube/payments/             payment records and derived invoice payment status
cube/efactura/             RO e-Factura: UBL builders, CIUS-RO limits, EN 16931 validation
standalone/                host, never packaged; config.ts and failure-log.ts at its root
standalone/http/           server, security headers, static UI, SPA route contract, readiness, API docs
standalone/auth/           credentials, browser session, login throttle
standalone/api/            authenticated endpoints: HttpApi contract, schemas, handlers, branding normalizer
standalone/storage/        PostgreSQL store, pool and transactions, row mappers, migration runner, schema fingerprint
standalone/documents/      PDF renderer and layout, artifact store and recovery, bundled fonts
standalone/efactura/       host mapping from issued documents to the e-Factura cube
standalone/ops/            CLI, backup and restore
standalone/parity/         tests that hold host, UI and cube rules in agreement
standalone/ui-dist/        built UI, ignored by git
web/                       browser UI: React 19, TypeScript, Tailwind CSS 4, Vite
web/src/lib/               API client, models, formatting, pure state and fiscal helpers
web/src/hooks/             React hooks: queries, authoring sessions, idempotency
web/src/components/ui/     shared primitives: buttons, load more
web/src/components/        layout (shell, page, async states), document, authoring, invoice, settings, catalog
web/src/views/             one component per route
bin/qwbe-invoicing.ts      CLI entry point, also the container command
probes/                    repository gates: runtime, package shape, tests, size, boundaries
scripts/                   e-Factura fixtures, the local warden helper, the Docker verifier rig (verify-docker.sh)
docs/                      local development and release procedures
compose.yaml               local development stack
compose.prod.yaml          production bundle
Dockerfile                 multi-stage build, pinned Node image
```

Stack: Node 24, TypeScript, [Effect](https://effect.website) (`effect`, `@effect/platform`),
`pdf-lib`, PostgreSQL 16 through `pg`, React 19, Vite, pnpm.

## Development

Every storage, API, HTTP, auth, ops and probe test talks to a live PostgreSQL 16 server,
so the suite does not run on the host. It runs in the pinned verifier container, against a
throwaway cluster on tmpfs that publishes no port and references no application volume:

```bash
scripts/verify-docker.sh install                 # dependencies into the named volumes, frozen
scripts/verify-docker.sh verify                  # pnpm verify: runtime gate, lint, typecheck,
                                                 # tests, frontend build and runtime, package/
                                                 # test/size/boundary gates
scripts/verify-docker.sh test                    # pnpm test only — the fast loop
scripts/verify-docker.sh test "node --test standalone/storage/pagination.test.ts"
scripts/verify-docker.sh down                    # stops both rigs; removes no volume
pnpm dev:ui                                      # Vite dev server for the browser UI
```

The gates keep the core inside the QWBE cube contract: no host or infrastructure imports
from `cube/`, no cube-to-cube imports, size caps per file and per unit, a test next to every
cube. A change that breaks a gate is not mergeable.

### UI theme and dependency policy

Tailwind CSS 4 is configured CSS-first in `web/src/app.css`; this setup does not use a
`tailwind.config` file. Invoice colors, typography, shadows and border radii live in its
top-level `@theme` block as CSS variables. They generate semantic utilities such as
`bg-invoice-primary`, `text-invoice-ink`, `border-invoice-border`,
`rounded-invoice-control` and `rounded-invoice-panel` whenever those classes are used, while
the existing component classes consume the same variables directly. The explicit
`@source ".."` boundary includes the React tree in Tailwind's class detection;
moving UI source outside `web/` requires updating that boundary.

Any third-party UI component, icon or font library added to this project must be free to use
and MIT-licensed. Check the package's published license before adding it and record that check
in the change or pull-request notes. This is a review requirement; commercial packages,
non-MIT packages and packages with unclear licensing are not accepted.

The shared button primitives use `tailwind-variants` 3.3.1 (MIT) for typed variants and its
`cn()` helper for deterministic Tailwind class merging. The configured `tv()` and `cn()`
exports in `web/src/lib/classnames.ts` are the required class-composition boundary so custom invoice
utilities merge consistently. `class-variance-authority` is not used because its Apache-2.0
license does not satisfy this repository's UI dependency policy.

## Relation to QWBE

QWBE Invoicing is built as an application for the [QWBE](https://github.com/theZenNana/qwbe)
platform: a package of cubes with its own runtime, its own database and its own UI, taking
user authentication from the QWBE mother and exposing its API for other applications to
compose (a CRM issuing invoices, for example). The exact installation contract with the
mother is still being decided; until then the standalone host is the only supported way to
run it, and it is a complete product on its own.

Further cubes are planned inside the same application: ANAF e-Factura transport, RO CIUS
XML export, and an export in the format accepted by SAGA.

## Documents

- [`PRODUCT.md`](./PRODUCT.md): product scope, legal boundary, capabilities, lifecycle,
  deployment, delivery phases, open decisions, references to Romanian legislation and ANAF.
- [`FOUNDATION.md`](./FOUNDATION.md): architecture, host contracts, packaging, alignment
  with the QWBE mother.
- [`docs/LOCAL_DEVELOPMENT.md`](./docs/LOCAL_DEVELOPMENT.md): local setup, full route
  inventory, operational checks.
- [`docs/RELEASE.md`](./docs/RELEASE.md): production bundle, install, upgrade, backup,
  restore, rollback.

## License

MIT. Copyright (c) 2026 HINT ONE ZERO SRL. See [`LICENSE`](./LICENSE).
