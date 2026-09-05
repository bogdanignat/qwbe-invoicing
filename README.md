# QWBE Invoicing

**Self-hosted invoicing for Romania.** Issues, preserves, corrects and tracks payment of
Romanian invoices (facturi) and non-fiscal proformas under Romanian fiscal rules: document
series with sequential numbering, CUI/CIF validation, VAT per line, immutable issued
documents, and correction by storno instead of editing.

Jurisdiction and currency are fixed to Romania (`RO`) and Romanian leu (`RON`) in the first
release. The data model is prepared for RO e-Factura (EN 16931 / RO CIUS), but this version
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
  IBAN and bank, VAT regime, logo, default payment terms and notes.
- **Customers** (optional register): companies with a valid CUI/CIF, or natural persons with
  an optional CNP. A document can also be issued to a one-time buyer typed directly in the
  editor, so the register and draft persistence are conveniences, not prerequisites. A saved
  customer may define a default payment term which prepopulates, but never locks, the due date.
- **Products and services** (optional presets): a short reusable list of descriptions and unit
  prices. Selecting one copies those values into an editable invoice line; there is no stock,
  SKU, price-list logic, or live relation to the saved preset.
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

One process, one container, one data directory. There is no external database server.

```text
browser ──> /app  (React UI)  ──┐
                                 ├──> standalone host ──> invoicing core ──> SQLite files
API client ──> /api (Bearer) ───┘        │                                    /data/*.sqlite
                                          └──> PDF renderer ──> /data/artifacts/<sha256>
```

- **The core** (`cube/invoicing`) holds the domain model, VAT arithmetic, party and date
  validation, the store ports and the idempotency rules, and composes the service from its
  components. It knows nothing about HTTP, SQLite or the browser. It depends only on a small
  set of host contracts (`cube/invoicing/contracts/host.ts`): who is calling and for which
  organization, a clock, an id generator, a transactional store and a renderer.
- **The component cubes** under `cube/invoicing/` each own one piece of the logic and share
  the parent's domain: `registry` (issuer, VAT configurations, document series, customers,
  product presets), `drafts` (authoring a document, draft and line editing), `issuance`
  (numbered invoices and proformas, conversion, idempotent replay), `corrections` (storno)
  and `documents` (rendered PDF artifacts, their hashes and recovery).
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
| Runtime | Docker Engine with Docker Compose v2 (recommended), or Node 24.19 and pnpm 11 for a bare install |
| Architecture | `linux/amd64` or `linux/arm64` images on GHCR |
| Storage | one writable volume for the SQLite databases and PDFs; a few hundred MB is plenty for years of invoices |
| Network | the app listens on port `3000` inside the container; put a TLS reverse proxy in front (a Caddy profile is included) |
| Secrets | one API token file, generated by you, mounted as a Docker secret |

## Installation

The supported way is the versioned Docker Compose bundle. Each release ships
`compose.prod.yaml`, `.env.example`, `Caddyfile.example`, `image-digests.txt` and the docs.
Images live at `ghcr.io/bogdanignat/qwbe-invoicing:<version>`.

```bash
# 1. Data and secret locations on the host
mkdir -p /opt/qwbe-invoicing/secrets && chmod 700 /opt/qwbe-invoicing/secrets
openssl rand -hex 32 > /opt/qwbe-invoicing/secrets/api-token
chmod 600 /opt/qwbe-invoicing/secrets/api-token

# 2. The bundle
cp compose.prod.yaml Caddyfile.example /opt/qwbe-invoicing/
cp .env.example /opt/qwbe-invoicing/.env
cd /opt/qwbe-invoicing
# edit .env: IMAGE_TAG, ORGANIZATION_ID, AUTH_TOKEN_PATH, APP_DOMAIN (see Configuration)

# 3. Optional TLS: copy Caddyfile.example to Caddyfile and set your domain

# 4. Start. `migrate` runs first; `app` starts only if migrations succeed.
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

What the bundle enforces: the container runs as a non-root user with a read-only root
filesystem and a `tmpfs` on `/tmp`; a named volume `qwbe-invoicing-data` on `/data`; the
API token comes from a file-based secret and is never in the image, the environment or the
logs; `app` depends on `migrate` completing successfully; the health check hits
`/health/ready`.

For a local development setup with Docker Compose see
[`docs/LOCAL_DEVELOPMENT.md`](./docs/LOCAL_DEVELOPMENT.md). For a bare-metal run without
Docker: `pnpm install`, `pnpm build:ui`, then `node bin/qwbe-invoicing.ts migrate --apply`
and `node bin/qwbe-invoicing.ts serve` with the variables below set.

## Configuration

Everything is configured through environment variables, read once at startup.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port inside the container |
| `HOST` | `0.0.0.0` | bind address |
| `DATA_DIR` | `/data` | directory holding the SQLite files and the `artifacts/` tree |
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

## Data, backup and restore

All durable state lives under `DATA_DIR`:

```text
/data/invoicing.sqlite    issuer, customers, series, drafts, invoices, proformas, payments, corrections
/data/documents.sqlite    artifact metadata of the documents cube
/data/sessions.sqlite     browser sessions (revocable, cleared on restore)
/data/artifacts/          PDFs stored by SHA-256
```

Back up with the CLI, not by copying files while the app runs:

```bash
docker compose -f compose.prod.yaml exec app \
  node bin/qwbe-invoicing.ts backup --output /data/backup-$(date +%F).tar.gz --json
```

The archive carries a manifest with SHA-256 per file. `restore --input <archive>` is a
dry-run that verifies the manifest; `restore --input <archive> --apply` writes files after
verifying each hash and is safe to re-run. In production, stop `app` before restoring and
run `doctor --json` and `migrate --json` afterwards. `docker compose down -v` deletes the
volume and is never a backup strategy.

## Upgrading

```bash
cd /opt/qwbe-invoicing
IMAGE_TAG=0.4.0@sha256:<new-digest> docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml exec app \
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
generated from the same Effect `HttpApi` contract that serves the routes.

| Area | Routes |
|---|---|
| Issuer | `GET`, `PUT /api/issuer` |
| Series | `GET`, `POST /api/document-series` |
| Customers | `GET`, `POST /api/customers`, `GET`, `PUT`, `DELETE /api/customers/:id` |
| Product presets | `GET`, `POST /api/product-presets`, `PUT`, `DELETE /api/product-presets/:id` |
| Drafts | `GET`, `POST /api/drafts`, `GET`, `PUT`, `DELETE /api/drafts/:id`, lines under `/api/drafts/:id/lines` |
| Issue | `POST /api/invoices`, `POST /api/drafts/:id/issue` |
| Invoices | `GET /api/invoices`, `GET /api/invoices/:id`, `POST`, `GET /api/invoices/:id/pdf` |
| Payments | `GET`, `POST /api/invoices/:id/payments`, `POST /api/invoices/:id/payments/:paymentId/reversal` |
| Corrections | `GET`, `POST /api/invoices/:id/corrections`, `GET /api/corrections/:id` |
| Proformas | `POST /api/proformas`, `POST /api/drafts/:id/proformas`, `GET /api/proformas`, `GET /api/proformas/:id`, `POST /api/proformas/:id/invoice`, `POST`, `GET /api/proformas/:id/pdf` |
| Health | `GET /health/live`, `GET /health/ready` (no auth) |

Registries (`GET /api/customers`, `/api/product-presets`, `/api/drafts`, `/api/invoices`, `/api/proformas`)
are paged: the response is `{ "items": [...], "nextCursor": "..." | null }`, `?limit=` takes 1 to 200
(default 100) and `?cursor=` repeats the previous `nextCursor`. Documents are ordered by issue date,
number and id, registries by name and id, so a cursor stays valid while new records arrive.

Issued invoices have no `DELETE`. Mistakes are handled through correction documents.
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
outside development also require `--confirm-production`. `doctor` reports storage,
migrations, organization, token file and Node version, and exits non-zero while any check
fails, so it can gate a deployment.

## Security model

- The API token is the only credential. It is read from a file, never printed, never stored
  in the image.
- The browser UI exchanges the token once for a revocable, opaque 30-day session held in an
  `HttpOnly`, `SameSite=Strict` cookie (`Secure` under HTTPS and in production). The token
  never reaches browser JavaScript, storage or the URL. State-changing requests carry a
  per-session CSRF token.
- Permissions are explicit per operation: read, manage customers, draft, issue invoices,
  issue proformas, void, record payments, manage settings.
- Issued documents are immutable; PDFs are content-addressed and verified on read.
- The container is read-only and non-root. TLS, rate limiting and network exposure are the
  reverse proxy's job; the included Caddy profile sets HSTS and the usual hardening headers.

## Repository layout

```text
cube/invoicing/            core: domain model, VAT arithmetic, ports, contracts, migrations, service composition
cube/invoicing/registry/   component: issuer, VAT configurations, document series, customers, product presets
cube/invoicing/drafts/     component: document authoring, draft and line editing
cube/invoicing/issuance/   component: numbered invoices and proformas, conversion, idempotent replay
cube/invoicing/corrections/ component: correction documents (storno)
cube/invoicing/documents/  component: rendered PDFs and artifact recovery
cube/payments/             payment records and derived invoice payment status
standalone/                host: HTTP, SQLite store, sessions, PDF renderer, CLI, backup
web/                       browser UI: React 19, TypeScript, Tailwind CSS 4, Vite
bin/qwbe-invoicing.ts      CLI entry point, also the container command
probes/                    repository gates: runtime, package shape, tests, size, boundaries
docs/                      local development and release procedures
compose.yaml               local development stack
compose.prod.yaml          production bundle
Dockerfile                 multi-stage build, pinned Node image
```

Stack: Node 24, TypeScript, [Effect](https://effect.website) (`effect`, `@effect/platform`),
`pdf-lib`, SQLite through `node:sqlite`, React 19, Vite, pnpm.

## Development

```bash
pnpm install
pnpm verify        # runtime gate, lint, typecheck, tests, package/test/size/boundary gates
pnpm dev:ui        # Vite dev server for the browser UI
pnpm test          # builds the UI, then runs the Node test suites
```

The gates keep the core inside the QWBE cube contract: no host or infrastructure imports
from `cube/`, no cube-to-cube imports, size caps per file and per unit, a test next to every
cube. A change that breaks a gate is not mergeable.

### UI theme and dependency policy

Tailwind CSS 4 is configured CSS-first in `standalone/ui/app.css`; this setup does not use a
`tailwind.config` file. Invoice colors, typography, shadows and border radii live in its
top-level `@theme` block as CSS variables. They generate semantic utilities such as
`bg-invoice-primary`, `text-invoice-ink`, `border-invoice-border`,
`rounded-invoice-control` and `rounded-invoice-panel` whenever those classes are used, while
the existing component classes consume the same variables directly. The explicit
`@source "../../web"` boundary includes the React tree in Tailwind's class detection;
moving UI source outside `web/` requires updating that boundary.

Any third-party UI component, icon or font library added to this project must be free to use
and MIT-licensed. Check the package's published license before adding it and record that check
in the change or pull-request notes. This is a review requirement; commercial packages,
non-MIT packages and packages with unclear licensing are not accepted.

The shared button primitives use `tailwind-variants` 3.3.1 (MIT) for typed variants and its
`cn()` helper for deterministic Tailwind class merging. The configured `tv()` and `cn()`
exports in `web/src/classnames.ts` are the required class-composition boundary so custom invoice
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
