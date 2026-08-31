# Release bundle — install, upgrade, backup, restore, rollback

Each versioned release on GHCR (`ghcr.io/bogdanignat/qwbe-invoicing:<version>` for `linux/amd64` + `linux/arm64`) should ship:

```text
compose.prod.yaml
.env.example
Caddyfile.example
image-digests.txt
docs/RELEASE.md   (this file)
docs/LOCAL_DEVELOPMENT.md
```

## Install (first time, production host)

```bash
# 1. Create data and secret locations on the host (bind mount or named volume)
mkdir -p /opt/qwbe-invoicing/secrets && chmod 700 /opt/qwbe-invoicing/secrets
openssl rand -hex 32 > /opt/qwbe-invoicing/secrets/api-token && chmod 600 /opt/qwbe-invoicing/secrets/api-token

# 2. Copy the bundle to /opt/qwbe-invoicing
cp compose.prod.yaml Caddyfile.example /opt/qwbe-invoicing/
cp .env.example /opt/qwbe-invoicing/.env
# Edit /opt/qwbe-invoicing/.env:
#   IMAGE_TAG=0.3.0            (or 0.3.0@sha256:<digest> for strict pin)
#   ORGANIZATION_ID=...        (legal entity id for this host)
#   AUTH_TOKEN_PATH=/opt/qwbe-invoicing/secrets/api-token
#   APP_DOMAIN=invoice.example.com  (only if using --profile proxy)

# 3. (Optional TLS) edit Caddyfile
cp Caddyfile.example /opt/qwbe-invoicing/Caddyfile
# set invoice.example.com

# 4. Start — migrate runs first, app starts only on success
cd /opt/qwbe-invoicing
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml up -d
# or with TLS:
docker compose -f compose.prod.yaml --profile proxy up -d

# 5. Verify — no secret is printed, health is separate
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/ready
```

Requirements enforced by the bundle: `read_only: true`, `tmpfs: /tmp`, named volume `qwbe-invoicing-data`, `depends_on: migrate: service_completed_successfully`, `HEALTHCHECK` on `/health/ready`, secrets from file.

## Upgrade

```bash
cd /opt/qwbe-invoicing
# Pin the new version (prefer digest-pinned from image-digests.txt)
IMAGE_TAG=0.4.0@sha256:<new-digest> docker compose -f compose.prod.yaml pull
IMAGE_TAG=0.4.0@sha256:<new-digest> docker compose -f compose.prod.yaml up -d
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
docker compose -f compose.prod.yaml logs --tail=100 migrate app
```

Never use `docker compose down -v` as an upgrade step — it deletes the named volume.

## Backup and restore (drill)

Backup is read-only and idempotent; restore verifies `manifest.json` SHA-256 before each write and is idempotent — safe to retry after partial failure.

```bash
# Backup to a host path (recommended: host-mounted directory, not inside the volume)
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts backup --output /data/backup-$(date +%F).tar.gz --json
# Or to host:
mkdir -p /opt/qwbe-invoicing/backups
docker compose -f compose.prod.yaml run --rm -v /opt/qwbe-invoicing/backups:/backup app node bin/qwbe-invoicing.ts backup --output /backup/qwbe-$(date +%F).tar.gz --json

# Dry-run restore (verifies manifest without writing)
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts restore --input /data/backup-2026-08-31.tar.gz --json

# Restore — stop app first, then restore, then verify
docker compose -f compose.prod.yaml stop app
docker compose -f compose.prod.yaml run --rm -v /opt/qwbe-invoicing/backups:/backup -v qwbe-invoicing-data:/data \
  ghcr.io/bogdanignat/qwbe-invoicing:${IMAGE_TAG} node bin/qwbe-invoicing.ts restore --input /backup/qwbe-2026-08-31.tar.gz --apply --confirm-production --json
docker compose -f compose.prod.yaml up -d
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts migrate --json
```

Separately protect `ORGANIZATION_ID`, `AUTH_TOKEN_PATH` contents, `Caddyfile`/`compose.prod.yaml` edits and `image-digests.txt` — they are operator config, not part of the data backup.

## Rollback

```bash
# Roll back to the previous digest-pinned version
IMAGE_TAG=0.3.0@sha256:<previous-digest> docker compose -f compose.prod.yaml pull
IMAGE_TAG=0.3.0@sha256:<previous-digest> docker compose -f compose.prod.yaml up -d
docker compose -f compose.prod.yaml exec app node bin/qwbe-invoicing.ts doctor --json
```

If DB migrations moved forward and the old image cannot read the new schema, restore the matching backup from before the upgrade instead of only downgrading the image.

## Offline image bundle (optional)

```bash
docker save ghcr.io/bogdanignat/qwbe-invoicing:0.3.0 | gzip > qwbe-invoicing-0.3.0-images.tar.gz
# On the air-gapped host:
gunzip -c qwbe-invoicing-0.3.0-images.tar.gz | docker load
```

## Security and audit notes

- Secrets are mounted from `${AUTH_TOKEN_PATH}` as a Compose secret (`/run/secrets/api_token`), never baked into the image or printed. `doctor --json` reports only `authTokenReadable`, never the value.
- `issued_invoices`, `issued_lines`, `issued_tax_breakdown`, `invoice_artifacts` and `invoice_sequences` are append-only / guarded by triggers — verified by `doctor --migrationsReady` and the boundary/size gates (`pnpm verify`). Direct mutation of an issued fiscal snapshot must fail with `issued invoices are immutable`.
- Keep `invoice_artifacts` immutable: the PDF object key is `sha256/<2>/<64>.pdf` and reads verify key + digest + byte length.
