# Local Docker development with Warden

The local hostname is `invoice.test`. Warden owns ports 80/443, local `.test` DNS,
and the development certificate authority. The application Compose project joins
the external `warden` Docker network; it does not publish an application port.

## First setup on microq

```bash
pnpm local:setup             # dry-run
pnpm local:setup --apply     # starts Warden services and signs invoice.test once
docker compose build
docker compose up -d
docker compose ps
curl --fail --cacert ~/.warden/ssl/rootca/certs/ca.cert.pem https://invoice.test/health/ready
```

`migrate` runs once before `app` and initializes `/data/invoicing.sqlite`. Repeated
`docker compose up -d` is safe: the migration is idempotent and does not consume
invoice numbers or create business records.

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
docker compose logs --tail=100 app migrate
```

The first migration command is dry-run unless `--apply` is supplied. In non-development
environments, applying also requires `--confirm-production`.
