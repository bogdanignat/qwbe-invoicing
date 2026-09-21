# Next frontend preview — T-1400, phase one

The new `frontend/` package is an opt-in application in the existing pnpm workspace.
It provides the unlock screen, session restore/logout and an authenticated preview
landing page. **The invoice list and other business screens are not migrated yet.**
The existing Vite UI, public API, default Compose/Warden routing and release image
remain operational. This phase does not switch traffic or remove `web/`.

## Ownership and request flow

- App Router pages compose `views`, `components`, `hooks` and `lib`; existing file
  size caps and dependency rules apply to `frontend/src` too.
- Browser requests use `/api/qwbe/...`. A single transport mapping preserves the
  logical API paths. Next route handlers contact the fixed `INVOICING_API_URL`.
- The backend owns authentication and session storage. A token is entered only in
  the unlock form and sent in the login request; it is not stored in browser storage,
  QueryClient, a frontend environment variable, or a bearer cookie.
- The existing opaque `qwbe_session` cookie remains host-only, `HttpOnly`,
  `SameSite=Strict`, `Path=/api`. HTTPS origins require `Secure`; the isolated HTTP
  development fixture can use a non-Secure cookie. Production backend cookies remain
  Secure. Do not use this HTTP fixture configuration as a production deployment.
- The cookie is not available on page requests, intentionally: pages contain no
  private server-rendered data. A per-provider session controller restores auth before
  displaying the authenticated shell. API authorization is always enforced by backend.
- Mutation requests require exact configured Origin and CSRF. BFF rejects incoming
  Authorization, duplicate session cookies, path traversal and untrusted forwarded
  identities. It does not follow upstream redirects or retry mutations automatically.
- PDF/XML remain byte streams with ETag and download headers. Requests are limited to
  1,000,000 bytes. A 30-second end-to-end deadline includes body upload; timeout after
  backend commit is an uncertain outcome, not a promise of rollback. Explicit retries
  must reuse the operation's idempotency key when its payload is unchanged.
- Responses, including gateway errors, are `no-store` with `nosniff`. Page CSP uses a
  per-request nonce and dynamic rendering, not broad `unsafe-inline` scripts. The
  Next `proxy.ts` supplies security headers only; it is not an authentication guard.
- Login throttle remains owned by the backend and keyed by the socket peer. All
  browsers behind this preview share that bucket, as with the existing reverse proxy.
  This is accepted for the loopback preview; per-client throttling requires an explicit
  trusted-ingress design before a multi-user cutover, not arbitrary X-Forwarded-For trust.

## Verification

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm verify
```

`verify` includes both UI builds, frontend type generation/typecheck, existing and
new unit/integration tests, and package/test/size/boundary gates. Pure server modules
are tested with Node; framework route adapters carry the `server-only` markers.
The new package declares its own dependencies. No TypeScript path aliases are used;
the architecture gate rejects unresolved imports rather than silently overlooking them.

After the production build, `test:frontend:runtime` starts the real Next standalone
server on temporary loopback ports. It checks backend session exchange, actual HTTP
header/path handling, chunked uploads, CSP nonce attachment, binary streaming and
gateway errors. The deployed 30-second timeout is exercised without shortening the
production configuration. Servers, credentials and database fixtures are cleaned up.
Binary transport checks use controlled byte fixtures; they do not replace the
existing backend document-generation tests or the browser checks for each migrated screen.

## Isolated container preview

Use **only** `compose.preview.yaml` for this fixture. It has a separate project,
network, backend and project-scoped volume, no Warden attachment, and no reference to
the existing `invoicing-data` volume. Every service requires the `preview` profile.
Only the frontend is exposed, on loopback. Do not use the existing API token file.

Create a separate synthetic token, intentionally writing only preview configuration:

```bash
mkdir -p .local/next-preview && chmod 700 .local/next-preview && (umask 077; openssl rand -hex 32 > .local/next-preview/api-token)
```

Keep this file private; do not paste it into logs or commit it. If it already exists,
reuse it instead of regenerating it. The backend's `node` user (UID 1000) must be able
to read the mounted file. Configure the path explicitly in each command:

```bash
PREVIEW_AUTH_TOKEN_PATH=./.local/next-preview/api-token docker compose -f compose.preview.yaml --profile preview config --quiet
PREVIEW_AUTH_TOKEN_PATH=./.local/next-preview/api-token docker compose -f compose.preview.yaml --profile preview build
PREVIEW_AUTH_TOKEN_PATH=./.local/next-preview/api-token docker compose -f compose.preview.yaml --profile preview up -d --wait
```

The first command validates configuration without creating containers. The explicit
`up` command runs the existing migration CLI against the **preview-only** volume.
It then starts the fixture backend and frontend. Re-running `up` reuses this fixture;
it does not reset its sessions or data. Nothing is mounted into the frontend except
its ephemeral writable cache/tmpfs; it does not receive the backend token or data.

Open `http://invoicing-next.localhost:3181` in a browser that resolves `.localhost`
to loopback. Use the synthetic token from the preview file. This is a different
hostname from the existing `invoice.test` installation: a different port alone
would **not** isolate cookies. No `/etc/hosts` or live Warden changes are necessary.

To change the port, set **both** `PREVIEW_PORT` and `PREVIEW_ORIGIN` consistently.
`FRONTEND_ORIGIN` must exactly match the browser's scheme/host/port, with no trailing
slash. The fixed internal upstream is `http://backend-fixture:3000`.

Health endpoints are distinct: frontend `/healthz` reports its own process;
backend `/health/live` and `/health/ready` report backend health. Frontend startup
does not require a responsive upstream, so backend outages can be displayed as errors.
Missing or malformed frontend runtime configuration fails before the server listens.

Inspect or stop **only** this preview project:

```bash
PREVIEW_AUTH_TOKEN_PATH=./.local/next-preview/api-token docker compose -f compose.preview.yaml --profile preview ps
PREVIEW_AUTH_TOKEN_PATH=./.local/next-preview/api-token docker compose -f compose.preview.yaml --profile preview down
```

`down` preserves the preview volume. Add `--volumes` only when intentionally discarding
this synthetic fixture; never apply that command to the default/live Compose project.

## Images and remaining migration

Both Dockerfiles use the pinned Node/pnpm versions. The frontend build context is
the repository root. Standalone tracing produces `frontend/server.js`; the runner
copies `.next/static` beside it and validates runtime configuration before startup.
It runs non-root with a read-only filesystem and a narrow writable cache/tmpfs.
No repository source bind mounts are needed. If a `frontend/public` directory is
introduced later, its runtime copy must be added explicitly.

Phase-one images are local `qwbe-invoicing:t1400-preview` and
`qwbe-invoicing-frontend:t1400-preview`. They are not automatically published.
The backend Dockerfile already accounts for the new workspace manifests while
continuing to build and serve the legacy UI.

Later migration steps: port each existing business screen, preserve T-1399 and
encoded IDs/idempotency/download behavior, redirect UI `/products` to `/catalog`,
then remove Vite/static serving from the backend. The final cutover must update
both Caddy and Traefik routing and publish two coordinated image digests. None of
those traffic or release changes is part of this preview phase.
