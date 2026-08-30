# Local Docker development with Warden

The local hostname is `invoice.test`. Warden owns ports 80/443, local `.test` DNS,
and the development certificate authority. The application Compose project joins
the external `warden` Docker network; it does not publish an application port.

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
child documents cube database `/data/documents.sqlite`. Repeated `docker compose up -d`
is safe: both migration plans are idempotent and do not consume invoice numbers
or create business records. The API reads its standalone bearer
credential from the Compose secret; the secret is never stored in the image or
printed by the application. `ORGANIZATION_ID` selects the trusted organization for
this initial single-organization host adapter.

Authenticated invoice-core routes are available under `/api`: `PUT /api/issuer`,
`POST /api/customers`, `POST /api/drafts`, `POST /api/drafts/{id}/lines`,
`POST /api/drafts/{id}/issue`, `GET /api/invoices/{id}`,
`POST /api/invoices/{id}/pdf` (idempotent render),
`GET /api/invoices/{id}/pdf` (download with SHA-256 ETag),
`POST /api/invoices/{id}/payments` (record payment), and
`GET /api/invoices/{id}/payments` (list payments with derived status `unpaid`/`partially_paid`/`paid`/`overpaid`/`overdue`, `paidAmount` and `remainingAmount`). Issued invoices remain immutable; payments are separate records and never mutate the fiscal snapshot. For local calls, pass
`Authorization: Bearer $(cat .local/api-token)` and JSON request bodies. The bearer
adapter is the API-first standalone transport; the cube receives only the verified
identity and organization context.

Stop containers without deleting data:

```bash
docker compose down
```

Never use `docker compose down -v` as a normal reset; `-v` deletes the SQLite volume.

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
