# Local Docker development with Warden

The local hostname is `invoice.test`. Warden owns ports 80/443, local `.test` DNS,
and the development certificate authority. There is one image: the kernel `app`
serves the UI (the Vite build in `frontend/dist`, `QWBE_UI_DIR`) and `/api` on
`https://invoice.test`. `app` joins the external `warden` Docker network and Warden's
Traefik routes `invoice.test` straight to it; no port is published.

> Runtime: every request is an `Effect`. The kernel authenticates (`Bearer` → `RequestContext`), injects `Clock`/`IdGenerator`/`TransactionalStore`, and runs the cube service `Effect` via `Effect.runPromise(Effect.either(...))`. Failures are typed (`ValidationFailure` → 400, `PermissionDenied` → 403, `ResourceNotFound` → 404, `DomainConflict` → 409).

## First setup on the dev host

The dev host is the machine that runs Docker and Warden.

```bash
pnpm local:setup             # dry-run
pnpm local:setup --apply     # starts Warden services and signs invoice.test once
cp -n .env.example .env      # default secret paths: ./.local/...
scripts/init-secrets.sh      # api-token, pg-password, company-lookup-key, anaf-token-key; 0600, never overwritten
docker compose build         # one image; its ui-builder stage runs `pnpm build:frontend`
docker compose up -d
docker compose ps
curl --fail --cacert ~/.warden/ssl/rootca/certs/ca.cert.pem https://invoice.test/health/ready
docker compose exec app wget -qO- http://127.0.0.1:3000/health/ready
```

A checkout whose stack still runs the earlier two-service layout (a separate `frontend`
container in front of the kernel) moves to the single image with
`docker compose up -d --build --remove-orphans`: the orphan container is removed and the
volumes stay. If `migrate` then refuses the database as drift, the baseline changed
since the cluster was created; see README, "Schema during development".

`scripts/init-secrets.sh` creates the four secret files once and keeps them on every
later run. Never regenerate `.local/pg-password` after the
cluster exists (PostgreSQL keeps the first password and `migrate` then fails with
`password authentication failed`), and never regenerate an existing `.local/api-token`.
A new `.local/company-lookup-key` makes a stored openapi.ro key unreadable: the
provider reads as off until the key is entered again in Integrări. A new
`.local/anaf-token-key` makes the stored ANAF tokens unreadable: e-Factura asks for the
certificate again.
To change the password, or to start over, see README, [Database
password](../README.md#database-password).

All the secrets are files the operator creates. Nothing in this repository holds a
credential, no default password exists, and the PostgreSQL password is never passed
as `PGPASSWORD`: the server reads it through `POSTGRES_PASSWORD_FILE` and the
application through `PGPASSWORD_FILE`, so it reaches neither a child process nor
`docker inspect`. Outside `development` a missing or empty password file is a refusal
to start, not a fallback. `.env.example` lists the paths and the volume names.

Persistence is a PostgreSQL 16 cluster in the `db` service — a container like
everything else here, pinned by digest, on its own named volume, with the cluster
initialised `--locale=C --encoding=UTF8` because the schema's indexes and keyset
cursors are written against binary text ordering. Its port is not published; only the
application network reaches it. PostgreSQL here is a kernel choice and the
mother's Postgres is a different database: `FOUNDATION.md` section 18 explains why
this still does not describe mounted operation.

Boot order is enforced by Compose, not by documentation: `db` healthy → `migrate`
completes successfully → `app` starts. `app` never migrates: it takes the maintenance
barrier SHARED and answers `503` on `/health/ready` and on every `/api` route until
the barrier, the schema and the artifact directory all agree. Repeated
`docker compose up -d` is safe: migration is idempotent and does not consume invoice
or proforma numbers or create business records. While the project is in development each
cube owns one baseline migration; a database created from an older baseline is refused
as drift and has to be recreated (README, "Schema during development"). The API reads its kernel bearer
credential from the Compose secret; the secret is never stored in the image or
printed by the application. `ORGANIZATION_ID` selects the trusted organization for
this initial single-organization host adapter.

The UI at `https://invoice.test` is the Vite + TanStack Router application in
`frontend/`, built into `frontend/dist` and served by the kernel on the same origin as
the API: the browser calls `/api/*` directly. The kernel pins `Host` and, on writes,
`Origin` to `PUBLIC_ORIGIN`, which `compose.yaml` sets to `https://${APP_DOMAIN}`. The
Bearer API is off on that listener unless `QWBE_BEARER_API=on`.

Session mechanics are owned by the kernel. On unlock, it exchanges the local bearer token for a revocable, opaque 30-day session persisted in the `browser_sessions` table and referenced by the `qwbe_session` cookie (`Path=/api`, `HttpOnly`, `SameSite=Strict`, `Secure` for HTTPS origins and in production). The token is never written to browser JavaScript, storage, or the URL. State-changing requests carry a per-session CSRF token in `x-csrf-token`, held only in memory; the UI restores it from the cookie-backed session after a reload or host restart.

The authenticated Swagger page is `GET /api` on `invoice.test` (linked from Settings), behind the browser session: a caller without a valid session is redirected to `/unlock`. Its OpenAPI 3.1 document is generated from the same Effect `HttpApi` contract served by `HttpApiBuilder`; it is not a separately maintained endpoint list. The page stays behind the session so the full contract is not exposed anonymously.

The backend serves the Vite build in `QWBE_UI_DIR` (T-1912), read once at startup into memory; a request never builds a path on disk. `/api*` and `/health*` come first, then a file of the build (hashed `assets/*`: `public, max-age=31536000, immutable`; `index.html`: `no-store`), then `index.html` for every other `GET`/`HEAD`, so deep links load the application. A missing file under `/assets/` answers `404`, other methods `405`. `/` is the application: the old identity JSON is gone. A symlink or special file in the build refuses to start. In production `serve` refuses to start without a build; in development and tests the kernel runs without one and the UI routes answer `503` (`ui_not_built`).

## UI development with vite dev

For work on `frontend/` with hot reload, the Vite dev server serves the UI and proxies
`/api` to the kernel. It needs Node 24.19 and pnpm 11 on the host and the frontend
dependencies installed there (`pnpm install`); the kernel keeps running in Docker:

```bash
docker compose -f compose.yaml -f compose.vite.yaml up -d   # kernel on 127.0.0.1:3000
pnpm --filter @qwbe/invoicing-frontend dev                  # http://localhost:5173
```

`compose.vite.yaml` publishes the kernel on `127.0.0.1:${KERNEL_DEV_PORT:-3000}` only and
sets its `PUBLIC_ORIGIN` to `http://localhost:5173`. Vite forwards `/api` to
`QWBE_KERNEL_URL` (default `http://127.0.0.1:3000`; set it when `KERNEL_DEV_PORT`
changes) with `Host` and `Origin` exactly as the browser sent them, so the kernel's
Host, Origin and CSRF checks judge the real request; nothing is rewritten to make it
pass. The dev server's port is fixed at 5173 for the same reason (`frontend/vite.config.ts`).
While the overlay is on, `https://invoice.test` answers `400` (its Host no longer
matches); `docker compose up -d` without it restores Warden. Check the production
bundle, without the dev server, with `pnpm build:frontend` (it writes `frontend/dist`).

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
- `GET /api/invoice-register` — read-only paged register combining issued invoices and storno documents; rows are discriminated by `kind`, retain stored signed totals, and corrections link to the organization-scoped original invoice. Invoice `dueDate` is nullable and `eFacturaStatus` is non-null unless the e-Factura plugin is off (`QWBE_PLUGINS`), when it is `null`; correction values are both `null`. It accepts the normal source filter and a dedicated keyset cursor; `/api/invoices` remains invoice-only
- `GET /api/reports/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD` — dashboard revenue per issue month: issued invoices plus storno documents (negative), `revenueExcludingVat`, `invoicedIncludingVat`, `invoiceCount`, `correctionCount`, every month of the period (empty ones as zero) and the period `totals`. Both dates inclusive, at most 36 calendar months; anything else is `400 ValidationFailure`. Needs `invoicing:read`; always on
- `GET /api/reports/collections?from&to&status=all|paid|unpaid|overdue` — payments plugin only (404 and absent from OpenAPI when it is off). `months`/`collected`: payments minus reversals by `paymentDate` in the period, so a month can be negative; independent of `status`. `invoices`: invoices issued in the period with today's status and balance (`paid` = paid + overpaid, `unpaid` = unpaid + partially paid + overdue), totals over every match, `items` the first 50 by `dueDate` (none last), then id. A storno does not change an invoice's payment status or balance. Needs `payments:read` (or the legacy `invoicing:read`)
- `POST /api/invoices/:id/pdf` (idempotent render) / `GET /api/invoices/:id/pdf` (download with SHA-256 ETag)
- `POST /api/invoices/:id/payments` (record payment; requires `Idempotency-Key`) / `POST /api/invoices/:id/payments/:paymentId/reversal` (reverse one payment in full with an immutable counter-row; requires `Idempotency-Key`, optional `reason`) / `GET /api/invoices/:id/payments` (list payments with derived status `unpaid`/`partially_paid`/`paid`/`overpaid`/`overdue`, `paidAmount`/`remainingAmount`)
- `POST /api/invoices/:id/corrections` (storno fiscal — creează document nou imuabil cu referință la factura originală, motiv obligatoriu; cantitate negativă, preț unitar pozitiv, totaluri negative; XML-ul e-Factura e CreditNote cu valori pozitive) / `GET /api/invoices/:id/corrections` / `GET /api/corrections/:id` — după emitere nu se mai editează factura, doar storno
- Issued invoices have no `DELETE` endpoint and allocated invoice numbers are never reused; mistakes are handled through correction documents
- `POST /api/efactura/connection/start` / `GET /api/anaf/callback` / `GET|DELETE /api/efactura/connection` — the ANAF OAuth connection of the `efactura` plugin (404 when it is off): start answers ANAF's `authorizeUrl` and sets the attempt cookie (`efactura:connection.manage`, 409 without the ANAF variables), the callback answers only a 303 to `/integrations?anaf=<code>`, the status never carries a token (`efactura:read`); see docs/EFACTURA.md
- `GET|PUT /api/settings/company-lookup` (`settings.manage`; `provider` `none`/`anaf`/`openapi`, write-only `openapiKey`, `clearOpenapiKey`; answers only `openapiKeyLast4`) / `GET /api/company-lookup/availability` / `POST /api/company-lookup/lookup` `{cui}` / `POST /api/company-lookup/search` `{q}` — the `company-lookup` plugin (404 when it is off); a CUI under 4 digits or with a wrong check digit and a name under 6 letters answer 400 without asking ANAF or openapi.ro

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

Issued invoices remain immutable; payments are separate `Effect` records and never mutate the fiscal snapshot. For local Bearer
calls, set `QWBE_BEARER_API=on` in `.env` (or export it) before `docker compose up -d`
(off, the kernel answers 400 to any `Authorization`), call from inside the `app` container
(no port is published) with the Host of `PUBLIC_ORIGIN`, and add `Origin: https://invoice.test`
on POST, PUT, PATCH and DELETE (403 without it); a request that also carries the session
cookie is refused:

```bash
docker compose exec app sh -c 'wget -qO- --header "Host: invoice.test" \
  --header "Authorization: Bearer $(cat /run/secrets/api_token)" http://127.0.0.1:3000/api/customers'
```

Request bodies are JSON. The bearer adapter is the API-first kernel transport; the cube
receives only the verified identity and organization context.

Stop containers without deleting data:

```bash
docker compose down
```

Until the first real release, local development data is disposable and may be reset
deliberately. The `-v` form of `down` still must not be used as an accidental or
routine stop command: it deletes the PostgreSQL cluster volume, the artifact volume
and the backup staging volume in one go.

## ANAF e-Factura (OAuth client)

Sending invoices to ANAF needs an OAuth client registered at ANAF and two secret files.
Without them the stack runs as before and e-Factura answers "not configured"; nothing
else changes. Development always talks to ANAF **TEST** (`https://api.anaf.ro/test`):
`ANAF_ENVIRONMENT` is `test` unless `prod` is written out, and `prod` belongs only on a
production host. The tests never call ANAF; they use a fake server on loopback.

On a new installation:

1. **Register the application at ANAF** (logged in on anaf.ro with the qualified
   certificate, ANAF's OAuth application registration, "Editare profil Oauth"): grant
   type Authorization Code, callback URL exactly `https://invoice.test/api/anaf/callback`
   for development (a production host registers `https://<its host>/api/anaf/callback`).
   ANAF shows the client id and the client secret once; keep the secret out of chats,
   tickets and shell history.
2. **Write the client secret to its file**, mode 0600, without showing it or leaving it
   in the shell history: the command is in the README,
   [e-Factura with ANAF](../README.md#e-factura-with-anaf), step 3.

3. **Fill `.env`** (the paths are relative to it; `.local/` and `.env` are ignored by git
   and by the Docker build):

   ```bash
   COMPOSE_FILE=compose.yaml:compose.anaf.yaml
   ANAF_ENVIRONMENT=test
   ANAF_CLIENT_ID=<client id from ANAF>
   ANAF_REDIRECT_URI=https://invoice.test/api/anaf/callback
   ANAF_CLIENT_SECRET_PATH=./.local/anaf-client-secret
   ANAF_TOKEN_KEY_PATH=./.local/anaf-token-key
   ```

4. **Create the token key** if this checkout predates it: `scripts/init-secrets.sh` (it
   keeps every existing file and adds `.local/anaf-token-key`).
5. **Restart**: `docker compose up -d`. `compose.anaf.yaml` mounts both files as Docker
   secrets (`ANAF_CLIENT_SECRET_FILE`, `ANAF_TOKEN_KEY_FILE`); a missing value stops
   Compose, and the application refuses a partial or malformed setup at startup (all four
   client values or none; the redirect URI must be `https://<PUBLIC_ORIGIN host>/api/anaf/callback`;
   the token key must differ from the company-lookup key).
6. **Connect** in Integrări → ANAF e-Factura with "Conectează cu certificatul"
   (T-1346): the browser goes to ANAF, the certificate is chosen there, and ANAF sends it
   back to the callback. The tokens stay in the backend, encrypted with the token key.
   The flow, its codes and its residual
   risk are in [EFACTURA.md](EFACTURA.md#connecting-to-anaf-oauth-t-1346).

Keep `.local/anaf-token-key` for as long as the connection should survive: a new key
makes the stored tokens unreadable and the organization reconnects with its certificate. Backups never carry the
connection: after a restore, connect again.

## Laptop hosts and certificate trust

While the laptop is on the same LAN, add this line to its hosts file:

```text
<dev-host-lan-ip> invoice.test
```

When connecting over Tailscale instead, use:

```text
<dev-host-tailscale-ip> invoice.test
```

Copy the **public** Warden root CA from the dev host and trust it as a local development CA:

```text
~/.warden/ssl/rootca/certs/ca.cert.pem
```

Do not copy anything from `~/.warden/ssl/rootca/private/`. After the CA is trusted,
open `https://invoice.test`. The leaf certificate remains on the dev host and is served by
Warden Traefik.

## Operational checks

```bash
docker compose exec app node bin/qwbe-invoicing.ts migrate --json
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
to the font in `kernel/documents/assets/fonts/`.

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
carried over. Operator-provided configuration (`ORGANIZATION_ID`, `PUBLIC_ORIGIN`,
the secret files), image digests and externally stored recovery secrets are
**not** in the backup; include them separately in your runbook.

Staging is a volume, not RAM: `TMPDIR` is `/var/backups/staging` inside the container
and `/tmp` is a bounded tmpfs, because the archive bounds allow a 1 GiB expanded tree.

Both commands require the application to be stopped. They take the same maintenance
key EXCLUSIVE that `app` holds SHARED for the life of its process, as a *try*: a
refusal is immediate, because a maintenance command that blocks behind a healthy
application looks like a hang. Each `run` carries `--no-deps`: `db` is already up, and
a plain `run` would also start the `migrate` service and change the schema first.

```bash
docker compose stop app

# Create a versioned archive (or directory) with manifest + SHA-256 verification
docker compose run --rm --no-deps app node bin/qwbe-invoicing.ts backup --output /data/backup-2026-08-31.tar.gz --json
docker compose run --rm --no-deps -v $(pwd)/.local/backup:/backup app node bin/qwbe-invoicing.ts backup --output /backup/qwbe-backup.tar.gz --json

# Restore — into a FRESH, empty database AND a fresh artifact volume, never the live
# `qwbe_invoicing` and `/data`: restore deletes nothing, so it refuses a populated
# target, the dry-run included. The archive comes from the host directory above.
docker compose exec db psql -U qwbe -d postgres \
  -c "CREATE DATABASE qwbe_invoicing_restored TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C' ENCODING 'UTF8'"
docker volume create qwbe-invoicing-data-restored
# Dry-run restore — validates the whole archive and reports the target, writing nothing
docker compose run --rm --no-deps -e PGDATABASE=qwbe_invoicing_restored \
  -v qwbe-invoicing-data-restored:/data -v $(pwd)/.local/backup:/backup:ro app \
  node bin/qwbe-invoicing.ts restore --input /backup/qwbe-backup.tar.gz --json

# Apply restore; outside development it also requires --confirm-production
docker compose run --rm --no-deps -e PGDATABASE=qwbe_invoicing_restored \
  -v qwbe-invoicing-data-restored:/data -v $(pwd)/.local/backup:/backup:ro app \
  node bin/qwbe-invoicing.ts restore --input /backup/qwbe-backup.tar.gz --apply --json

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
