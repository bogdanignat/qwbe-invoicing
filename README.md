# QWBE Invoicing

**Self-hosted invoicing for Romania.** Issues, preserves, corrects and tracks payment of
Romanian invoices (facturi) and non-fiscal proformas under Romanian fiscal rules: document
series with sequential numbering, CUI/CIF validation, VAT per line, immutable issued
documents, and correction by storno instead of editing.

Ghidul de instalare și configurare în română: [`docs/INSTALARE.md`](./docs/INSTALARE.md).

Jurisdiction and currency are fixed to Romania (`RO`) and Romanian leu (`RON`) in the first
release. The optional `efactura` plugin generates RO e-Factura XML (EN 16931 / RO CIUS) and,
with your own ANAF OAuth client (`ANAF_*` variables and `compose.anaf.yaml`, see
[`docs/ANAF.md`](./docs/ANAF.md)), submits invoices and stornos to the SPV one at a time, on a
user's click. The full cycle is confirmed on ANAF TEST, not yet in production; see
[`docs/EFACTURA.md`](./docs/EFACTURA.md).

The product and engineering baseline is [`PRODUCT.md`](./PRODUCT.md), the architecture is
[`FOUNDATION.md`](./FOUNDATION.md). This page is the short version: what it is, how it
works, how to install and run it.

## Contents

- [Who it is for](#who-it-is-for)
- [What it does](#what-it-does)
- [What it does not do yet](#what-it-does-not-do-yet)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quick start (self-host)](#quick-start-self-host)
- [Installation](#installation)
- [Database password](#database-password)
- [Configuration](#configuration)
- [e-Factura with ANAF](#e-factura-with-anaf)
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
  Capital is exact nonnegative RON text: at most 16 integer digits and two decimals,
  so it fits the BIGINT column in bani, normalized to two decimal places without
  floating-point conversion. This is not
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
  atomically at issue time, are unique per organization, numbering type and series, continue
  across years (a new series starts again at 1) and are never reused. Uniqueness is enforced
  by the database, not only by the UI. A series is never deleted: archiving it (Settings →
  Series) removes it from new documents and issuing in it is refused, while its documents,
  stornos and counter stay; reactivating continues the counter.
- **Drafts**: editable, with manual lines (name, quantity, unit, unit price, VAT category and
  rate, allowances and charges), references (contract, order, delivery, preceding document),
  notes and payment terms. Drafts do not consume numbers. An open draft can move to another
  active series. Product presets are never required.
- **Issuing**: one atomic operation that validates the authored document, allocates the next number,
  freezes the totals and snapshots issuer, buyer, lines and tax breakdown. From then on the
  invoice is an immutable fiscal document. Later changes to the customer or issuer never
  alter it.
- **PDF**: rendered from the snapshot, stored by SHA-256 with template version and
  timestamp, downloadable with an ETag. The bundled DejaVu Sans font covers Romanian
  diacritics.
- **Proformas**: immutable, numbered, conspicuously marked `DOCUMENT NEFISCAL`, and invoiceable
  exactly once into an immutable fiscal snapshot. A proforma never consumes an invoice number;
  the resulting invoice receives its number atomically when issued. A proforma keeps the id of
  the saved customer it was issued to; converting it into a draft relinks the customer while it
  still exists.
- **Payments**: separate records allocated to invoices, with derived states `unpaid`,
  `partially_paid`, `paid`, `overpaid` and `overdue`. Payments never mutate the invoice.
- **Corrections (storno)**: an issued invoice is corrected by a new immutable document that
  references the original, with a mandatory reason. There is no delete for issued invoices.
- **Company lookup** (optional plugin `company-lookup`): the customer, one-time buyer and issuer
  forms propose a company's name, CUI, trade register number and address from its CUI, through
  ANAF (free, no key) or openapi.ro (with your key, which also suggests companies by name). The
  provider is chosen in **Integrări**; at most one is on, and both may be off. A
  proposal is a card with a **Completează** button: nothing in the form changes without that
  click. The issuer's VAT regime is never changed from a lookup.
- **Operations**: idempotent migrations, a `doctor` health report, artifact reconciliation,
  versioned backup with verified restore, liveness and readiness endpoints.

## What it does not do yet

- **No e-Factura without your ANAF registration.** Submission
  needs the installation's own ANAF OAuth client, set with the `ANAF_*` variables and
  `COMPOSE_FILE=compose.yaml:compose.anaf.yaml` (self-host: `compose.prod.yaml:compose.anaf.yaml`);
  without it the XML is downloaded and uploaded on another channel. Documents to a private
  person (B2C) go to ANAF's `uploadb2c`; the 5-working-day deadline is not tracked. Nothing
  is submitted automatically, and the cycle is confirmed on ANAF TEST only (B2C included). A PDF is a visual representation, not the structured XML the law requires.
- No simplified invoice, delivery note, receipt or fiscal receipt.
- No email delivery. Delivery means PDF download.
- No foreign issuers, foreign billing addresses or invoices in other currencies.
- One organization per installation.

This repository is not legal or tax advice. Special VAT regimes, cross-border transactions,
cash-register rules and sector-specific obligations must be validated with an accountant.

## How it works

One application process, one PostgreSQL 16 server, one data directory for the PDFs.

```text
browser ──> TLS proxy ──> kernel :3000 ──┬──> UI: the Vite build in frontend/dist (QWBE_UI_DIR)
                                         └──> /api ──> invoicing core ──> PostgreSQL 16
                                                  │                        one database, schema `public`
                                                  └──> PDF renderer ──> /data/artifacts/<sha256>
```

One image, `qwbe-invoicing`: the kernel serves the built UI and `/api` on one origin,
`PUBLIC_ORIGIN`, behind a TLS proxy (Caddy, Traefik or your own). The browser uses the
session cookie; the Bearer API is off on that listener unless `QWBE_BEARER_API=on`, and
internal clients run inside the Compose network (`docker compose exec app …`).

- **The core** (`cubes/invoicing`) holds the domain model, VAT arithmetic, date
  validation, the store ports and the idempotency rules, and composes the service from its
  components. It knows nothing about HTTP, the database or the browser. It depends only on a small
  set of host contracts (`cubes/invoicing/contracts/host.ts`): who is calling and for which
  organization, a clock, an id generator, a transactional store and a renderer.
- **The component cubes** under `cubes/invoicing/` each own one piece of the logic and share
  the parent's domain: `parties` (the Romanian fiscal rules for every party: CUI, CNP,
  counties and sectors), `items` (the article code and GTIN rules shared by the product
  nomenclature and every document line), `customers` (saved customers, with their own table and baseline),
  `catalog` (saved products and services and the unit-of-measure list they are chosen from,
  with their own table and baseline), `issuer` (issuer profile, branding and VAT
  configurations and their own tables and baseline), `drafts`
  (authoring a document, draft and line editing), `issuance` (numbered invoices and
  proformas, document series, conversion, idempotent replay), `corrections` (storno) and `documents`
  (rendered PDF artifacts, their hashes and recovery). `payments`, `efactura` and
  `company-lookup` are plugins: optional children (`required: false`), active by default and
  switched off at startup through `QWBE_PLUGINS` (see Configuration). A child enters another child only through its `index.ts`.
- **The kernel** (`kernel/`) is the composition root. It authenticates the
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
| Network | the app listens on port `3000` inside the container; put a TLS reverse proxy in front (a Caddy profile is included). Outbound HTTPS for company lookup, only to the provider switched on (`webservicesp.anaf.ro` or `api.openapi.ro`), and, with e-Factura on, to `logincert.anaf.ro` (OAuth), `api.anaf.ro` (SPV) and `webservicesp.anaf.ro` (validation) |
| Secrets | four files, generated by you (`scripts/init-secrets.sh`) and mounted as Docker secrets: the API token, the database password, the company-lookup master key and the ANAF token key (read only with `compose.anaf.yaml`) |

## Quick start (self-host)

The repository is all you need: build the image from the checkout, fill in `.env`, create
the secrets and start the production bundle (`compose.prod.yaml`). You need Docker Engine
with Compose v2 and, for TLS, a DNS name pointing at the host. No port is published until
you choose how TLS reaches the application (step 5).

```bash
# 1. The code
git clone https://github.com/bogdanignat/qwbe-invoicing.git
cd qwbe-invoicing

# 2. Settings: every key in the file says what it does and whether it is required
cp .env.example .env
# edit .env: PUBLIC_ORIGIN (e.g. https://invoice.example.com) and ORGANIZATION_ID.
# QWBE_IMAGE=qwbe-invoicing and IMAGE_TAG=local already match the build in step 4.

# 3. Secrets: the API token, the PostgreSQL password, the company-lookup key and the
#    ANAF token key, at the paths in .env (default .local/), mode 0600. An existing
#    file is kept, and nothing is printed. Never regenerate them while the database
#    exists. The same by hand: .env.example, "Secret files".
scripts/init-secrets.sh

# 4. The image, from this checkout: one image serves the UI and the API
docker build -t qwbe-invoicing:local .
```

5. TLS, one of the two:

   **a) The bundled Caddy** (profile `proxy`). It takes ports 80 and 443 on the host and
   gets the certificate itself:

   ```bash
   cp Caddyfile.example Caddyfile
   # replace invoice.example.com in Caddyfile with the host of PUBLIC_ORIGIN
   docker compose -f compose.prod.yaml --profile proxy up -d
   ```

   **b) A reverse proxy already running on this host** (nginx, Caddy, Traefik), next to
   other applications. `compose.loopback.yaml` publishes `app` on `127.0.0.1` only:

   ```bash
   # in .env: APP_LOOPBACK_PORT=3180 (any free port)
   docker compose -f compose.prod.yaml -f compose.loopback.yaml up -d
   ```

   The proxy must pass the public `Host` and `X-Forwarded-Proto` unchanged: the
   application compares them, and `X-Forwarded-Host` when present, with `PUBLIC_ORIGIN`,
   and answers `400` otherwise. Add HSTS at the proxy; the application does not send it.

   ```nginx
   server {
     listen 443 ssl;
     http2 on;
     server_name invoice.example.com;
     ssl_certificate     /etc/ssl/invoice.example.com/fullchain.pem;
     ssl_certificate_key /etc/ssl/invoice.example.com/privkey.pem;
     add_header Strict-Transport-Security "max-age=31536000" always;

     location / {
       proxy_pass http://127.0.0.1:3180;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     }
   }
   ```

   ```caddy
   invoice.example.com {
     reverse_proxy 127.0.0.1:3180 {
       header_up Host {host}
       header_up X-Forwarded-Proto {scheme}
     }
   }
   ```

   A Traefik that runs in Docker cannot reach the host's loopback: attach `app` to
   Traefik's network with your own override file instead, the way `compose.yaml` does
   for the local Warden setup.

6. Check it. `/health/ready` answers `200` once the database is reachable and the
   schema is migrated:

   ```bash
   docker compose -f compose.prod.yaml ps                     # app: healthy
   docker compose -f compose.prod.yaml exec app wget -qO- http://127.0.0.1:3000/health/ready
   curl -fsS https://invoice.example.com/health/ready         # through the proxy
   curl -fsS http://127.0.0.1:3180/health/ready               # b) only: the loopback port
   docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
   ```

Then open `PUBLIC_ORIGIN`, unlock the UI with the API token (the file at
`AUTH_TOKEN_PATH`) and configure the issuer and the first invoice series.

To skip `-f`/`--profile` on every command, set `COMPOSE_FILE` (and `COMPOSE_PROFILES`) in
`.env`; `.env.example` shows both. e-Factura with ANAF needs your own registration:
[e-Factura with ANAF](#e-factura-with-anaf).

## Installation

The quick start above builds the image from the checkout. A versioned release instead
ships `compose.prod.yaml`, `compose.loopback.yaml`, `.env.example`, `Caddyfile.example`,
`image-digests.txt` and the docs, with one published image: set `QWBE_IMAGE` to the
registry path (default `ghcr.io/bogdanignat/qwbe-invoicing`) and `IMAGE_TAG` to the
digest from `image-digests.txt`, e.g. `IMAGE_TAG=0.3.0@sha256:<digest>`, then
`docker compose -f compose.prod.yaml pull` and continue from step 3. Install, upgrade,
backup, restore and rollback of a release are in [`docs/RELEASE.md`](./docs/RELEASE.md).

What the bundle enforces: the application container runs as a non-root user with a
read-only root filesystem and a bounded `tmpfs` on `/tmp`; named volumes
`qwbe-invoicing-data` on `/data`, `qwbe-invoicing-postgres` for the cluster and
`qwbe-invoicing-backup-staging` for `TMPDIR`; the database publishes no port and is
reachable only on the application network; the application publishes none either, except
on `127.0.0.1` with `compose.loopback.yaml`; the API token and the database password come
from file-based secrets and are never in the image, the environment or the logs; `app`
depends on `db` being healthy and on `migrate` completing successfully; the health check
hits `/health/ready`; `PUBLIC_ORIGIN`, `IMAGE_TAG` and the three secret paths have no fallback.

For a local development setup with Docker Compose see
[`docs/LOCAL_DEVELOPMENT.md`](./docs/LOCAL_DEVELOPMENT.md). For a bare-metal run without
Docker: `pnpm install`, then `node bin/qwbe-invoicing.ts migrate --apply`
and `node bin/qwbe-invoicing.ts serve` with the variables below set, against a PostgreSQL 16
database that already exists and whose role owns it.

## Database password

The PostgreSQL password is a file, generated once by you before the first start. The
same file is mounted as a Docker secret into `db` (which sets the password when it
creates the cluster) and into `migrate`/`app` (which use it to connect). It never goes
into `.env` or into an environment variable.

### Generate it (once, before the first `up`)

`scripts/init-secrets.sh` creates the four files (API token, database password,
company-lookup key, ANAF token key) at the paths in `.env`, mode 0600, and never
overwrites one that exists. The ANAF token key is read only with `compose.anaf.yaml`
(e-Factura, docs/LOCAL_DEVELOPMENT.md); the ANAF client secret is never generated. Local development (paths used by `compose.yaml`):

```bash
cd /path/to/invoicing-qwbe
cp -n .env.example .env    # the default secret paths are ./.local/...
scripts/init-secrets.sh
pnpm local:setup --apply   # once per machine: Warden network, DNS and certificate
docker compose up -d       # add --build after code changes
docker compose ps
curl --fail --cacert ~/.warden/ssl/rootca/certs/ca.cert.pem https://invoice.test/health/ready
```

The full local walkthrough is in [`docs/LOCAL_DEVELOPMENT.md`](./docs/LOCAL_DEVELOPMENT.md).
Self-host: step 3 of the [Quick start](#quick-start-self-host), with the same script.

If a secret file is missing, `docker compose up` stops with `bind source path does not
exist: .../pg-password` (or `.../api-token`) and warns `secret file ... does not exist`:
create the file and run `up` again. A failed `up` like this does not initialise the cluster, so nothing has to
be removed first.

### Do not regenerate it after the first start

PostgreSQL reads the file only once, when the cluster is created on an empty volume.
Writing a new value into the file later changes nothing in the database: `migrate` and
`app` would then connect with the new value and fail with
`password authentication failed`. To change the password, rotate it (below).

### Look at the data

You do not need the password for this. The port is not published and, inside the `db`
container, `psql` connects over the local socket without a password:

```bash
docker compose exec db psql -U qwbe -d qwbe_invoicing
```

The password is needed only by a client outside the container (for example a GUI client
through a port you publish yourself); read it with `cat .local/pg-password`.

### Rotate it, keeping the data

```bash
umask 077
openssl rand -hex 32 > .local/pg-password.new
docker compose stop app
docker compose exec db psql -U qwbe -d qwbe_invoicing
#   qwbe_invoicing=# \password qwbe
#   (paste the contents of .local/pg-password.new twice, then \q)
mv .local/pg-password.new .local/pg-password
docker compose up -d --force-recreate
```

`\password` hashes the new password in the client, so it never appears in a statement
log; do not use `ALTER ROLE ... PASSWORD '...'`. `--force-recreate` is required, not a
plain restart: the secret is a bind mount of the old file, and `mv` replaces the file.
In production run the same steps with `-f compose.prod.yaml` (and `--profile proxy` if
you run Caddy) and the path from `PG_PASSWORD_PATH`; the same applies to looking at the
data above.

### Start over, losing the local data

Local development only, irreversible: `down -v` deletes this project's volumes (the
cluster, the PDFs and the backup staging), whatever names `.env` gives them.

```bash
docker compose down -v
rm .local/pg-password
# generate the file again (above), then:
docker compose up -d
```

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
| `ORGANIZATION_ID` | none (`local-organization` in the Compose files) | the internal, stable id of the company this installation serves, e.g. `hint` or `ro12345678`; every record is scoped to it, the ANAF tokens included. Set it in production. Not a secret, and printed on no invoice, PDF or XML. Only an empty value is refused; use lowercase letters, digits and hyphens, no spaces. Chosen once, before the first start, and never changed: records under the old id would no longer be found, and a restore needs the same id |
| `AUTH_TOKEN_FILE` | none | path to the file holding the API bearer token (the Compose secret mounts it at `/run/secrets/api_token`) |
| `COMPANY_LOOKUP_KEY_FILE` | none | path to the company-lookup master key: 32 bytes as 64 hex characters (`openssl rand -hex 32`), mounted at `/run/secrets/company_lookup_key`. It encrypts the openapi.ro key at rest (AES-256-GCM). Unset: storing an openapi.ro key is refused (409 `company_lookup_key_storage_unavailable`) and everything else runs; set but unreadable or malformed: the application does not start. A different key makes the stored openapi.ro key unreadable: the provider reads as off until the key is entered again |
| `PUBLIC_ORIGIN` | none | the canonical public origin, e.g. `https://invoice.example.com` (scheme and host, no path or trailing slash). `Host`, `X-Forwarded-Host`/`-Proto` and, on unsafe methods, `Origin` must match it, otherwise 400/403. Validated whenever it is set; required only to serve in production (`migrate`, `backup`, `restore` and `doctor` run without it). Outside production it may be left out only when `HOST` is a loopback address, and the origin is then the address the server listens on. In Compose it comes from `.env`, required with no fallback in `compose.prod.yaml`; `compose.yaml` derives it from `APP_DOMAIN` and `compose.vite.yaml` sets `http://localhost:5173` |
| `QWBE_BEARER_API` | `off` | `on` serves the Bearer API on the same listener as the browser. Off, any `Authorization` header (empty included) is refused with 400. On, a request carrying both `Authorization` and a session cookie is still refused, and an unsafe request still needs `Origin: <PUBLIC_ORIGIN>`. Any other value stops the application at startup |
| `QWBE_UI_DIR` | none | the Vite build the kernel serves (`index.html`, hashed `assets/*`), read once at startup; empty means unset. Required to serve in production (the image sets `/app/frontend/dist`); elsewhere the kernel runs without it and the UI routes answer 503 `ui_not_built`. A symlink or special file in it stops the application at startup |
| `QWBE_TRUSTED_PROXY` | none | the reverse proxies whose `X-Forwarded-For` keys the login throttle, comma-separated addresses or CIDR ranges (`172.18.0.0/16`, `fd00::/8`). Only a request whose socket peer is in the list is keyed on the right-most forwarded address that is not itself listed; everyone else keeps the socket address, whatever they forward. From a listed proxy, a repeated or malformed `X-Forwarded-For` answers 400, and a missing one, or one whose every address is listed, keys on the proxy. An unreadable entry or a `/0` range stops the application at startup. Set it to the proxy's fixed address (or its network) only when that proxy overwrites `X-Forwarded-For` for untrusted clients, as Caddy and Traefik do by default. The Compose files pass it through from `.env` only when set: unset, every client behind the bundled Caddy or your own proxy shares the proxy's throttle bucket |
| `QWBE_PLUGINS` | absent: every plugin | the optional plugins to run, comma-separated: `payments`, `efactura`, `company-lookup`. Absent runs all three; empty (`QWBE_PLUGINS=`) runs none; an unknown name stops the application at startup with an error naming the known plugins. Spaces are ignored and duplicates tolerated; a change takes a restart. A plugin that is off has no route (404), no OpenAPI entry and, for payments, no `payments:*` grant; with e-Factura off every invoice response says `eFacturaStatus: null`; with company lookup off the forms show no lookup and no request leaves for ANAF or openapi.ro. Migrations, tables and data stay, so switching a plugin back on finds its records (and its company-lookup settings) |

Variables used only by the Compose files, in `.env`:

| Variable | Meaning |
|---|---|
| `QWBE_IMAGE` | image repository without a tag, default `ghcr.io/bogdanignat/qwbe-invoicing` in `compose.prod.yaml`; `qwbe-invoicing` for an image built from the checkout |
| `IMAGE_TAG` | image tag, required in `compose.prod.yaml`: `local` for your own build, or a release digest-pinned from `image-digests.txt`, e.g. `0.3.0@sha256:<digest>` |
| `APP_LOOPBACK_PORT` | host port on `127.0.0.1` for a reverse proxy already on the host; required by `compose.loopback.yaml`, unused otherwise |
| `AUTH_TOKEN_PATH` | host path of the token file mounted as the secret |
| `APP_DOMAIN` | local development only: the Warden domain in `compose.yaml`, default `invoice.test` |
| `DATA_VOLUME_NAME` | name of the data volume, default `qwbe-invoicing-data` |
| `PG_PASSWORD_PATH` | host path of the database password file, mounted as a secret into both `db` and the application (required with no fallback in `compose.prod.yaml`; `compose.yaml` defaults to `./.local/pg-password`) |
| `COMPANY_LOOKUP_KEY_PATH` | host path of the company-lookup master key file, mounted as a secret into the application (required with no fallback in `compose.prod.yaml`; `compose.yaml` defaults to `./.local/company-lookup-key`; the preview uses `PREVIEW_COMPANY_LOOKUP_KEY_PATH`) |
| `PG_VOLUME_NAME` | name of the cluster volume, default `qwbe-invoicing-postgres` |
| `BACKUP_STAGING_VOLUME_NAME` | name of the `backup`/`restore` staging volume, default `qwbe-invoicing-backup-staging` |

## e-Factura with ANAF

Optional, with the `efactura` plugin on. Without these settings the application runs as
before, e-Factura answers "not configured" and the XML of each document can still be
downloaded. What a company registers with ANAF is in [`docs/ANAF.md`](./docs/ANAF.md);
the registration itself, step by step, in
[`docs/LOCAL_DEVELOPMENT.md`](./docs/LOCAL_DEVELOPMENT.md), "ANAF e-Factura (OAuth client)".

1. **Register the OAuth application at ANAF** (grant type Authorization Code) with the
   callback `<PUBLIC_ORIGIN>/api/anaf/callback`, e.g.
   `https://invoice.example.com/api/anaf/callback` (development:
   `https://invoice.test/api/anaf/callback`). ANAF shows the client id and the client secret.
2. **The token key** (`ANAF_TOKEN_KEY_PATH`) is one of the four files
   `scripts/init-secrets.sh` creates. On a checkout that predates it, run the script
   again: it keeps every existing file and adds only the missing one. The same by hand:
   `.env.example`, "Secret files".
3. **Write the client secret** (`ANAF_CLIENT_SECRET_PATH`) to its file. It is never
   generated: it is the secret of your OAuth application in ANAF's portal. From the
   repository root, in bash, paste it at the prompt; nothing is shown, and the secret
   enters neither the shell history nor a process list:

   ```bash
   mkdir -p -m 700 .local
   ( umask 077; set -C; printf 'ANAF client secret: '; IFS= read -rs secret; echo; printf '%s' "$secret" > .local/anaf-client-secret )
   ```

   The file is 0600, with no final newline. `set -C` refuses to overwrite an existing
   file: delete it first to replace the secret. The application accepts one line of
   printable characters and refuses anything else at startup.
4. **Fill `.env`.** `COMPOSE_FILE` adds the overlay `compose.anaf.yaml`: on self-host
   after `compose.prod.yaml` (and `compose.loopback.yaml`, if you use it), in development
   `compose.yaml:compose.anaf.yaml`. `ANAF_REDIRECT_URI` is `<PUBLIC_ORIGIN>/api/anaf/callback`,
   exactly as registered at ANAF; the application refuses any other spelling at startup.
   `ANAF_ENVIRONMENT` is `test` unless `prod` is written out, and `prod` belongs only on
   the production host. `serve` refuses to start while the database holds submissions or
   received invoices from the other environment (`ANAF_ENVIRONMENT is prod, but e-Factura data
   (submissions or received invoices) exists for test; set it back or start from a database
   without it`), so the trial on TEST runs on a separate installation or on a database
   recreated before switching to `prod`.

   ```bash
   COMPOSE_FILE=compose.prod.yaml:compose.anaf.yaml
   ANAF_ENVIRONMENT=test
   ANAF_CLIENT_ID=<client id from ANAF>
   ANAF_REDIRECT_URI=https://invoice.example.com/api/anaf/callback
   ANAF_CLIENT_SECRET_PATH=./.local/anaf-client-secret
   ANAF_TOKEN_KEY_PATH=./.local/anaf-token-key
   ```

   All four client values or none: a partial setup stops Compose or the application.
5. **Restart**: `docker compose up -d` (with `COMPOSE_FILE` set, no `-f` is needed; the
   bundled Caddy also needs `COMPOSE_PROFILES=proxy`).
6. **Connect** in **Integrări → ANAF e-Factura** with "Conectează cu
   certificatul": the certificate is chosen at ANAF, and the tokens stay in the backend,
   encrypted with the token key. Each invoice or storno is then sent with "Trimite în
   e-Factura" ([`docs/EFACTURA.md`](./docs/EFACTURA.md)).

## Data, backup and restore

Durable state lives in two places:

```text
PostgreSQL `qwbe_invoicing`, schema `public`
                          issuer, customers, catalog, series, drafts, invoices, proformas,
                          payments, corrections, artifact metadata, audit events,
                          browser_sessions (rows excluded from every backup)
/data/artifacts/          PDFs stored by SHA-256
```

In production `scripts/production/backup.sh` and `restore.sh` do what follows, with a
daily systemd timer, retention and a switch to the restored pair
([`docs/RELEASE.md`](./docs/RELEASE.md), "Production scripts"). Back up with the CLI, not
by copying the cluster directory, and with the application stopped: `backup` and `restore` take the maintenance key EXCLUSIVE as a *try*, so both
refuse immediately while `app` holds it SHARED.

```bash
docker compose -f compose.prod.yaml stop app
docker compose -f compose.prod.yaml run --rm --no-deps app \
  node bin/qwbe-invoicing.ts backup --output /data/backup-$(date +%F).tar.gz --json
docker compose -f compose.prod.yaml start app
```

`--no-deps` on every `run` of `backup` or `restore`: `db` is already up, and a plain
`run` would also start the `migrate` service and change the schema first.

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

From a checkout of `main`, `scripts/production/deploy.sh` does the upgrade with its
backup, rollback and restore decision ([`docs/RELEASE.md`](./docs/RELEASE.md), "Upgrade").

An `.env` from an earlier release needs three new keys first (see `.env.example`):
`QWBE_PGDATABASE` (the current database, `qwbe_invoicing`) and `QWBE_DATA_VOLUME`
(the current data volume, `qwbe-invoicing-data`), which `compose.prod.yaml` now
requires, and `BACKUP_DIR` (an absolute directory outside the checkout), which the
scripts require.

By hand:

```bash
cd /opt/qwbe-invoicing
# back up with the version that runs now, before the new image is pulled or started
docker compose -f compose.prod.yaml stop app
docker compose -f compose.prod.yaml run --rm --no-deps app \
  node bin/qwbe-invoicing.ts backup --output /data/backup-$(date +%F).tar.gz --json
# then set IMAGE_TAG=0.4.0@sha256:<new-digest> in .env, pull and start
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml up -d
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
```

Migrations are applied by the `migrate` service on startup and are idempotent: they never
consume invoice or proforma numbers and never create business records. Rollback: restore
the backup taken before the upgrade, then start the previous image. The full procedure is in
[`docs/RELEASE.md`](./docs/RELEASE.md).

## API

One origin, `PUBLIC_ORIGIN`: the kernel serves the UI and every API route under `/api/*`
on it, with no second service in between. The browser authenticates with the session
cookie (`qwbe_session`, `Path=/api`, `HttpOnly`, `SameSite=Strict`) and sends the
per-session `x-csrf-token` header on writes.

The Bearer API (`Authorization: Bearer <token>`) is off on that listener unless
`QWBE_BEARER_API=on`; off, any `Authorization` header is refused. On, a Bearer caller
meets the same edge as the browser: `Host` must be the host of `PUBLIC_ORIGIN`, every
unsafe method sends `Origin: <PUBLIC_ORIGIN>`, and a request carrying both a session
cookie and `Authorization` is refused. Without switching it on, the CLI inside the
container (`docker compose exec app node bin/qwbe-invoicing.ts …`) is the operator's
interface. Locally, with `QWBE_BEARER_API=on` in `.env` (or exported) before
`docker compose up -d`, from inside the `app` container (no port is published):

```bash
docker compose exec app sh -c 'wget -qO- --header "Host: invoice.test" \
  --header "Authorization: Bearer $(cat /run/secrets/api_token)" http://127.0.0.1:3000/api/customers'
docker compose exec app sh -c 'wget -qO- --header "Host: invoice.test" --header "Origin: https://invoice.test" \
  --header "Authorization: Bearer $(cat /run/secrets/api_token)" --header "Content-Type: application/json" \
  --post-data "{\"documentType\":\"invoice\",\"series\":\"QWBE\"}" http://127.0.0.1:3000/api/document-series'
```

`GET /api` is the authenticated Swagger page (linked from Setări): without a valid
session it redirects to `/unlock`. Its OpenAPI 3.1 document is generated from the same
Effect `HttpApi` contract served by `HttpApiBuilder`.
The builder handles routing, decoding and response encoding; input errors retain
the existing `400 ValidationFailure` envelope. The server disposes its Effect
handler on shutdown.

| Area | Routes |
|---|---|
| Issuer | `GET`, `PUT /api/issuer` |
| VAT catalogue | `GET /api/vat-regimes` |
| Series | `GET`, `POST /api/document-series`, `PUT /api/document-series/:documentType/:series/archived` |
| Customers | `GET`, `POST /api/customers`, `GET`, `PUT`, `DELETE /api/customers/:id` |
| Product presets | `GET`, `POST /api/product-presets`, `PUT`, `DELETE /api/product-presets/:id` |
| Drafts | `GET`, `POST /api/drafts`, `GET`, `PUT`, `DELETE /api/drafts/:id`, lines under `/api/drafts/:id/lines` |
| Issue | `POST /api/invoices`, `POST /api/drafts/:id/issue` |
| Invoices | `GET /api/invoices`, `GET /api/invoices/:id`, `POST`, `GET /api/invoices/:id/pdf` |
| Invoice register | `GET /api/invoice-register` — paged invoices and storno documents |
| Reports | `GET /api/reports/revenue?from&to`; `GET /api/reports/collections?from&to&status` (payments plugin) |
| Payments | `GET`, `POST /api/invoices/:id/payments`, `POST /api/invoices/:id/payments/:paymentId/reversal` |
| Corrections | `GET`, `POST /api/invoices/:id/corrections`, `GET /api/corrections/:id` |
| Proformas | `POST /api/proformas`, `POST /api/drafts/:id/proformas`, `GET /api/proformas`, `GET /api/proformas/:id`, `POST /api/proformas/:id/invoice`, `POST /api/proformas/:id/draft-invoice`, `POST`, `GET /api/proformas/:id/pdf` |
| Company lookup | `GET`, `PUT /api/settings/company-lookup` (`settings.manage`; the openapi.ro key is write-only, answered only as `openapiKeyLast4`), `GET /api/company-lookup/availability`, `POST /api/company-lookup/lookup` `{cui}`, `POST /api/company-lookup/search` `{q}` (`company-lookup:company.lookup`) |
| Health | `GET /health/live`, `GET /health/ready` (no auth; the only paths exempt from `PUBLIC_ORIGIN` pinning, for the container healthcheck) |
| UI | every other `GET`/`HEAD`: a file of the `QWBE_UI_DIR` build, else `index.html` (deep links); a missing `/assets/*` file is 404, other methods 405, no build 503 |

Issuer configuration accepts `vatChange: { registered, effectiveFrom }` for VAT
registration, or `{ registered: false, effectiveFrom, nonVatBasis: "article_310" }`
for the supported small-business exemption. The UI generates this basis automatically
from the existing non-VAT registration setting; no second selection is required.
`nonVatBasis` is forbidden
when `registered` is true. These commands are accepted instead
of a caller-authored `vatConfigurations` history. The server builds that history
and returns it with `currentVat` (null when no registration is currently active).
The catalogue supplies date-effective line rates separately from issuer registration.
A change of regime or CIF is checked against ANAF's VAT registry and refused over
issued documents in the period it rewrites (`docs/VAT_TREATMENT.md`, T-1977).
CUI is stored as canonical digits without `RO`; VAT registration is explicit, never
inferred from a prefix. The UI may strip a typed `RO` prefix without changing the
registration checkbox. Company buyers also carry an explicit `vatRegistered` flag;
individual buyers must use `false` and may omit their CNP (empty identifier).
Issued snapshots preserve both parties' VAT status. UI/PDF derive a registered
party's VAT identifier as `RO` + CUI without consulting the current registry.
Addresses require one of the 42 Romanian ISO 3166-2 county codes. `RO-B` requires
an integer sector from 1 to 6; other counties prohibit a sector.
Positive invoices require `dueDate` before a number is allocated, including draft
issuance and proforma conversion. Drafts, proformas and zero invoices may omit it. In the editor, an open draft saved without
one is opened with the issue date plus the saved customer's payment term (else the issuer's);
the API itself adds no date.
Draft issuance rejects stale VAT without consuming a document number; saving a
stale draft refreshes affected lines even when their VAT code is unchanged. Issued
documents, external snapshots and proforma conversions retain their frozen values.

The invoice public contract owns these immutable fiscal facts; the e-Factura
exporter never reconstructs them from current profiles or private database tables.
Line/configuration/breakdown snapshots include `vatCategoryCode` and
`vatExemptionReason`: `S` for positive standard/reduced rates (reason `null`),
`E` at `0.00` for Article 310, with the frozen legal reason text.
The application supports Article 310 for its non-VAT issuer workflow and generates
the associated metadata automatically; other exemptions and categories O/Z/AE are
not supported. This bounded product rule is not an external fiscal-status lookup.
See [the fiscal treatment contract and evidence](docs/VAT_TREATMENT.md).
The UBL/CIUS-RO export and the ANAF transport live in the `efactura` plugin
([`docs/EFACTURA.md`](docs/EFACTURA.md)); the CIUS-RO Schematron is not run locally,
ANAF's validator checks every submission before the upload.

Numbered invoices, proformas and corrections expose a trusted `actorId`. Their
issuance, issuer/series configuration, payments and reversals append fiscal events
inside the business transaction; idempotent retries do not append duplicates.
`audit_events` rejects updates/deletes. There is no audit browsing endpoint yet.
Payments is an optional plugin under `invoicing` with its own `payments:*` permissions; recording a payment
is optional and is not required to issue an invoice. With `payments` off its routes answer 404
and storno keeps working. Document/PDF metadata and browser
sessions are owned by their own scopes and tables inside the one database, and
`eFacturaStatus` is retained.

**Schema during development:** one database holds every scope, so the ledger key is
`(scope, name)`. Each cube owns one baseline migration holding the current definition
of its tables, and they run in dependency order after the foundation — nine ledger
entries in total: `foundation/000-foundation`, `customers/customers-001-baseline`,
`catalog/catalog-001-baseline`, `issuer/issuer-001-baseline`,
`invoicing/invoicing-001-baseline`, `payments/payments-001-baseline`,
`documents/documents-001-baseline`, `company-lookup/company-lookup-001-baseline` and the host's own
`kernel/000-browser-sessions`. Customers and issuer precede invoicing because it
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

Money columns are `BIGINT` in bani (minor units): `123.45` RON is stored as `12345`,
a storno total as a negative integer, an absent social capital as `NULL`. The API, the
domain and e-Factura keep two-decimal strings; the one conversion is
`kernel/storage/postgres-money.ts`, without floating point. Quantities (four decimals)
and VAT rates stay `TEXT`. The PDF and the UI show amounts to people as `6,600.00`
(quantity `4,800.0000`, VAT rate `21`), through `kernel/documents/pdf-format.ts` and
`frontend/src/lib/money.ts`; the machine format (API, XML, database, inputs) does not change. The historical probes (`probes/pg-schema-*.mjs`) and the
SQLite captures in `kernel/parity/` describe the earlier TEXT money schema.

Registries (`GET /api/customers`, `/api/product-presets`, `/api/drafts`, `/api/invoice-register`, `/api/invoices`, `/api/proformas`)
are paged: the response is `{ "items": [...], "nextCursor": "..." | null }`, `?limit=` takes 1 to 200
(default 100) and `?cursor=` repeats the previous `nextCursor`. Documents are ordered by issue date,
number and id, registries by name and id, so a cursor stays valid while new records arrive.

`GET /api/invoice-register` is the read-only mixed fiscal register; `GET /api/invoices`
keeps its invoice-only contract. Every row has `kind`, its own `id`, series, number,
issue date, customer name, currency and stored total. Invoice rows expose nullable
`dueDate` and their `eFacturaStatus` (`null` when the e-Factura plugin is off), and omit `originalReference`. Correction
rows retain their negative total, expose `dueDate: null`, `eFacturaStatus: null`, and
reference the organization-scoped original invoice by id, series and number. The mixed
register uses a dedicated opaque cursor that also contains `kind`; invoice-list cursors
are rejected rather than interpreted in a different ordering.

Issued invoices have no `DELETE`. Mistakes are handled through correction documents, which are
numbered in the invoice series like any other invoice (Codul fiscal art. 330). Issue dates cannot be
in the future or before the last document numbered in the same series (numbering runs on across years), and an invoice
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

Three settings decide who can reach the application and what it believes about a
request. All three are read once at startup; a malformed value stops it instead of
being ignored.

- **`PUBLIC_ORIGIN`: the one origin the application answers on.** Scheme and host
  exactly as users type them, e.g. `https://invoice.example.com`. The kernel serves the
  UI, `/api` and the Swagger page only on it: a request whose `Host` (or, when the proxy
  sends them, `X-Forwarded-Host`/`-Proto`) names anything else is refused with 400, and a
  write (`POST`, `PUT`, `PATCH`, `DELETE`, the login included) whose `Origin` is not
  exactly this value with 403. That is what makes the session cookie useless to another
  site and a DNS-rebinding page useless against the server; it also means the reverse
  proxy must pass the public `Host` through unchanged. The scheme decides the cookie:
  an `https` origin (or `NODE_ENV=production`) marks it `Secure`. Only the
  `/health/*` checks answer on any Host, for the container healthcheck.
- **`QWBE_TRUSTED_PROXY`: whose `X-Forwarded-For` is believed.** It matters for one
  thing, the login throttle, which keys failed unlocks on the client address. Unset,
  nobody's forwarded header is read and the address is the TCP peer: behind a proxy
  that is the proxy itself, so every client shares one throttle bucket and a stranger's
  failed attempts slow everyone down. Set it to the proxy's fixed address or network
  (`172.18.0.0/16`, the Compose network of the bundled Caddy) only when that proxy
  overwrites `X-Forwarded-For` for the clients in front of it, as Caddy and Traefik do;
  a proxy that appends what the client sent would let anyone pick their own bucket.
  `/0` ranges are refused.
- **`QWBE_BEARER_API`: whether the API token is accepted on the public listener.**
  `off` by default: the browser never needs it (it exchanges the token once for a
  session, below), so any `Authorization` header is refused with 400 and the token
  cannot be guessed against the public origin. `on` serves the Bearer API on the same
  origin, for scripts and integrations; such a caller meets the same edge as the browser
  (the Host of `PUBLIC_ORIGIN`, `Origin` on every write, no session cookie alongside the
  token) and the same throttle. Without it, the operator's interface is the CLI inside
  the container (`docker compose exec app node bin/qwbe-invoicing.ts …`).

The rest of the model:

- The single API token is the shared owner/admin credential for the installation. Every
  holder receives owner access as actor `kernel-owner`; standalone mode has no users or
  separate authorization levels yet. The token is read from a file, never printed and never
  stored in the image. Rotate it by writing the new token into the secret file and
  recreating the container (`docker compose up -d --force-recreate app`, with
  `-f compose.prod.yaml` in production): a plain restart keeps the old file when the file
  was replaced rather than rewritten in place (see [Database password](#database-password)).
  The changed credential hash invalidates existing browser sessions.
- The browser UI exchanges the token once for a revocable, opaque 30-day session held in an
  `HttpOnly`, `SameSite=Strict` cookie (`Secure` under HTTPS and in production). The token
  never reaches browser JavaScript, storage or the URL. State-changing requests carry a
  per-session CSRF token.
- Failed browser unlocks and failed Bearer authentication are throttled in memory by the
  normalized socket peer address, or, when that peer is listed in `QWBE_TRUSTED_PROXY`, by the
  right-most `X-Forwarded-For` address that is not a listed proxy; nobody else's forwarded
  headers are read. The protection
  is instance-local. The first five failures have no cooldown; from the sixth failure,
  cooldowns are 1, 2, 4, 8, 16 and then at most 30 seconds.
  Entries expire after 15 minutes of inactivity, are capped at 10,000 with LRU eviction and
  reset on process restart; successful authentication resets the peer entry. Cookie-session
  requests are unaffected. Valid traffic is unaffected in normal state, but a valid Bearer
  request can receive `429 {"error":"too_many_attempts"}` with `Retry-After` while its shared
  peer is cooling down.
- NATs, and proxies that are not listed in `QWBE_TRUSTED_PROXY`, aggregate callers under one
  peer, creating an explicit risk of temporary shared lockout: behind Caddy or Traefik without
  it, a stranger's failed unlocks lock everyone out for the cooldown. Throttle logs contain neither
  secrets nor raw IP addresses and emit at most once per key per cooldown interval. This is
  login-throttling, not complete DDoS protection; enforce broad request-rate and network
  controls at the reverse proxy.
- The kernel guards its own edge, before routing, readiness, the body or any credential:
  the raw request-target is refused when it holds `.`/`..` segments, backslashes or control
  characters (also after repeated decoding); `Host` and `X-Forwarded-Host`/`-Proto` are pinned
  to `PUBLIC_ORIGIN` (health paths exempt); duplicate identity headers, an empty or repeated
  `qwbe_session` cookie and, unless `QWBE_BEARER_API=on`, any `Authorization` header answer
  400; every unsafe method, Bearer and login included, needs `Origin` equal to
  `PUBLIC_ORIGIN` (403). Every answer, errors and the `/api` → `/unlock` redirect included,
  carries a strict CSP (`default-src 'none'`, no inline), COOP, `Permissions-Policy`,
  `Referrer-Policy: no-referrer` and `nosniff`; API answers are `no-store`. Each request has a
  30-second deadline covering body, readiness, handler and response (504 `upstream_timeout`);
  the handler is interrupted on the deadline or when the client disconnects. An interrupted
  mutation is not rolled back once it has committed: the client simply does not learn its
  outcome.
- Issued documents are immutable; PDFs are content-addressed and verified on read.
- Company lookup: the openapi.ro key is write-only. It is stored encrypted (AES-256-GCM
  under the master key from `COMPANY_LOOKUP_KEY_FILE`, bound to the organization) and never
  answered, logged or put in an error; the settings show only its last four characters.
  Provider calls have a 5-second timeout, refuse redirects and bodies over 256 KB, and never
  pass the provider's error text on. A key openapi.ro refuses answers `502 auth_failed`,
  never `401`, so it does not end the browser session.
- The container is read-only and non-root. TLS and network exposure are the
  reverse proxy's job; the included Caddy profile sets HSTS and the usual hardening headers.

## Repository layout

```text
qwbe-package.json            plugin pack manifest: invoicing and its eleven child cubes
cubes/invoicing/             core: domain model, VAT arithmetic, ports, contracts, migrations, service composition
cubes/invoicing/parties/     component: CUI, CNP, counties and sectors shared by issuer and buyers
cubes/invoicing/items/       component: article code and GTIN rules shared by products and document lines
cubes/invoicing/customers/   component: saved customers, their table and baseline migration
cubes/invoicing/catalog/     component: saved products and services, their table and baseline migration
cubes/invoicing/issuer/      component: issuer profile, branding, VAT configurations and baseline
cubes/invoicing/drafts/      component: document authoring, draft and line editing
cubes/invoicing/issuance/    component: document series, numbered invoices and proformas, conversion, idempotent replay
cubes/invoicing/corrections/ component: correction documents (storno)
cubes/invoicing/documents/   component: rendered PDFs and artifact recovery
cubes/invoicing/payments/    plugin: payment records and derived invoice payment status
cubes/invoicing/efactura/    plugin: RO e-Factura UBL builders, CIUS-RO limits, EN 16931 validation
cubes/invoicing/company-lookup/ plugin: company lookup settings, CUI/name thresholds, ANAF and openapi.ro mapping
kernel/                      host, never packaged; config.ts and failure-log.ts at its root
kernel/http/                 server, security headers, readiness, API docs
kernel/auth/                 credentials, browser session, login throttle
kernel/api/                  authenticated endpoints: HttpApi contract, schemas, handlers, branding normalizer
kernel/storage/              PostgreSQL store, pool and transactions, row mappers, migration runner, schema fingerprint
kernel/documents/            PDF renderer and layout, artifact store and recovery, bundled fonts
kernel/efactura/             host mapping from issued documents to the e-Factura cube
kernel/company-lookup/       ANAF and openapi.ro HTTP clients, the openapi.ro key cipher, the lookup cache
kernel/ops/                  CLI, backup and restore
kernel/parity/               SQLite baseline fixtures read by the PostgreSQL schema gate
frontend/                    browser UI: Vite + TanStack Router (file routes in src/routes), built into
                             frontend/dist and served by the kernel from QWBE_UI_DIR
bin/qwbe-invoicing.ts        CLI entry point, also the container command
probes/                      repository gates: runtime, package shape, tests, size, boundaries
scripts/                     e-Factura fixtures, the local warden helper, the Docker verifier rig (verify-docker.sh)
docs/                        local development and release procedures
compose.yaml                 local development stack (Warden routes to app)
compose.prod.yaml            production / self-host bundle; compose.loopback.yaml publishes app on 127.0.0.1
compose.preview.yaml         opt-in preview of the image on its own fixture stack
Dockerfile                   the one image: pinned Node, kernel plus the UI built in its ui-builder stage
```

Stack: Node 24, TypeScript, [Effect](https://effect.website) (`effect`, `@effect/platform`),
`pdf-lib`, PostgreSQL 16 through `pg`; UI in React 19 with Vite, TanStack Router and
TanStack Query, Tailwind CSS 4; pnpm.

## Development

Every storage, API, HTTP, auth, ops and probe test talks to a live PostgreSQL 16 server,
so the suite does not run on the host. It runs in the pinned verifier container, on the
project's own `db` (started when it is down, never stopped), in throwaway databases named
`qwbe_t_<run>_…` that are dropped again; `qwbe_invoicing` is never used:

```bash
scripts/verify-docker.sh install                 # dependencies into the named volumes, frozen
scripts/verify-docker.sh verify                  # pnpm verify: runtime gate, lint, typecheck,
                                                 # tests, frontend build, the kernel probe
                                                 # (probes/app-runtime*.mjs), package/
                                                 # test/size/boundary gates
scripts/verify-docker.sh test                    # pnpm test only — the fast loop
scripts/verify-docker.sh test "node --test kernel/storage/pagination.test.ts"
scripts/verify-docker.sh down                    # stops both rigs; removes no volume
scripts/smoke-image.sh                           # the shipped image on its own compose project
```

The gates keep the core inside the QWBE cube contract: no host or infrastructure imports
from `cubes/`, no imports between separate cube trees, inside the invoicing tree a child
enters a sibling or a child only through its `index.ts` (it may use its ancestors' modules),
no required cube imports a plugin, size caps per file and per unit, a test next to every
cube. A change that breaks a gate is not mergeable.

### UI theme and dependency policy

Tailwind CSS 4 is configured CSS-first in `frontend/src/styles/globals.css`; this setup does
not use a `tailwind.config` file. Invoice colors, typography and border radii live in the
`@theme` block of `frontend/src/styles/theme.css` as CSS variables and generate semantic
utilities such as `bg-invoice-primary`, `text-invoice-ink` and `rounded-invoice-panel`.
The explicit `@source ".."` in `globals.css` limits class detection to `frontend/src`.

Any third-party UI component, icon or font library added to this project must be free to use
and MIT-licensed. Check the package's published license before adding it and record that check
in the change or pull-request notes. This is a review requirement; commercial packages,
non-MIT packages and packages with unclear licensing are not accepted.

## Relation to QWBE

QWBE Invoicing follows the package structure of the [QWBE](https://github.com/theZenNana/qwbe)
platform: one plugin pack with `invoicing` as the main cube and `payments` and `efactura` as
plugins. It keeps its own runtime, database, login and UI, and the QWBE mother installs
nothing. A later integration would let the mother call this API from its backend under the
contract in [`FOUNDATION.md`](./FOUNDATION.md) section 19; it is not implemented, and the
kernel is the only way to run the product.

RO CIUS XML export and ANAF e-Factura transport are in the `efactura` plugin. A further
cube is planned inside the same application: an export in the format accepted by SAGA.

## Documents

- [`docs/INSTALARE.md`](./docs/INSTALARE.md): ghidul de instalare și configurare în română.
- [`PRODUCT.md`](./PRODUCT.md): product scope, legal boundary, capabilities, lifecycle,
  deployment, delivery phases, open decisions, references to Romanian legislation and ANAF.
- [`FOUNDATION.md`](./FOUNDATION.md): architecture, host contracts, plugin pack, future
  mother contract.
- [`docs/LOCAL_DEVELOPMENT.md`](./docs/LOCAL_DEVELOPMENT.md): local setup, full route
  inventory, operational checks.
- [`docs/RELEASE.md`](./docs/RELEASE.md): production bundle, install, upgrade, backup,
  restore, rollback.
- [`docs/ANAF.md`](./docs/ANAF.md): what an installation registers with ANAF itself for
  e-Factura.

## License

MIT. Copyright (c) 2026 HINT ONE ZERO SRL. See [`LICENSE`](./LICENSE).
