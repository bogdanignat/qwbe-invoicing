# Next frontend preview — T-1400, phase one

> **T-1400 phase two (this branch, `feat/T-1400-next-authoring`):** invoice authoring and
> drafts are now migrated. `/invoices/new` authors a new invoice or draft,
> `/drafts/[id]` resumes one, and `/invoices` gained a "Factură nouă" CTA plus a cursor-paged
> drafts section. See the **Authoring and drafts** section below for the design notes and the
> exact gaps that remain. The existing Vite UI remains operational; nothing is cut over.

The new `frontend/` package is an opt-in application in the existing pnpm workspace.
It provides the unlock screen, session restore/logout, and the invoice register with
the invoice and correction document screens. **The remaining business screens — issuer
settings, payments — are not migrated yet** (issuing, drafts, proformas, the product
catalogue and the customer registry are, in the phases described below).
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
- An upstream `Set-Cookie` for `qwbe_session` that does not satisfy the cookie contract,
  or a second session cookie in the same response, fails the request with `502
  invalid_upstream_cookie` instead of being silently dropped from a `200`. A valid
  issue and a valid clear are forwarded unchanged; foreign cookie names are not forwarded.
- An HTTPS upstream is validated under the **upstream** identity: the BFF rewrites `Host`
  to the public origin, and Node would otherwise derive SNI and the certificate identity
  check from that rewritten header. A hostname upstream is asked for by that hostname; an
  IP-literal upstream sends an explicitly empty server name — not an omitted one — because
  RFC 6066 admits no address in SNI and Node then checks the certificate's IP entries.
  Trust comes from the process' own CA store (`NODE_EXTRA_CA_CERTS` at deployment level);
  there is no application setting for it and no bundled certificate.
- A `401` is attributed to the **session** the request *started* in, counted separately
  from the operation generation that cancels superseded restore/login/logout work: a
  logout the server refuses (`403`, `502`) cancels its own operation but leaves the
  session in place, so a `401` issued before that attempt is still honoured. A late `401`
  from a superseded session cannot close the session that replaced it, and once a session
  is closed, further `401`s are absorbed: a private view still mounted while the redirect
  to `/unlock` commits cannot re-trigger the cache wipe and the redirect. Session restore
  owns its own `401` and does not raise the shared event. Leaving a session cancels the
  in-flight queries before clearing the cache: the wipe alone already aborts them and
  discards late answers, while cancelling is what returns mounted observers to `idle`
  instead of leaving them waiting on a query that no longer exists.
- Every data read belongs to the authenticated shell: a query is `enabled` only while the
  session status is `authenticated` and passes the query's `signal` to the transport, so a
  view left mounted during the redirect neither keeps asking for private data nor leaves a
  request running after its screen is gone.
- Every data mutation captures the session epoch before it is sent and drops its own late
  side effects — downloads, cache writes, navigation — when that epoch is no longer the
  session in place. `AuthController.ownsEpoch` is the single seam for that question, and
  the document download is the first mutation to use it: a PDF whose render started in a
  session that has since ended is fetched, then discarded rather than saved.
- Logout is a no-op unless the session is authenticated and holds a CSRF token; it is
  never fabricated from an unauthenticated or token-less state.
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

The runtime probes also write escaped paths to the socket verbatim — a URL parser in
the test would resolve `..` before the server ever saw it — and assert both a non-`200`
answer and that the upstream fixture recorded **no** request for them. Upstream session
cookies are exercised through the real proxy (valid issue, valid clear, tampered,
malformed, duplicated). TLS is exercised against a throwaway CA and leaf certificate
generated with `openssl` into a temporary directory per run and trusted only by the
freshly spawned Next child through `NODE_EXTRA_CA_CERTS`: a trusted certificate for the
upstream hostname succeeds while the public `Host` differs, and a wrong-hostname or
unknown-issuer certificate fails with `502`. The same is asserted for an upstream
addressed by `127.0.0.1`: its IP certificate is accepted while the public host is a
different name, the upstream observes **no** server name in the handshake, and a
certificate for another address, a certificate for the public host name, or an unknown
issuer each fail with `502`. Missing or pre-1.1.1 `openssl` is reported by name before
any certificate command runs, instead of surfacing as `spawnSync openssl ENOENT` inside a
TLS assertion. Nothing is checked in and no verification is disabled.

**Coverage above is code-level; the screens were also driven in a real browser.** That
pass ran against the Node standalone Next build talking to a real backend on a temporary
isolated fixture — **not** against `compose.preview.yaml`; the container preview was not
exercised in this session. It checked keyboard focus visibility on the
light surface and on the sidebar, login, session restore across a reload, logout, a
wrong token, and a `502` during restore followed by a successful retry, at desktop and
at 320 px and 390 px widths. No unexpected JavaScript console errors were observed.
Screenshots are kept outside the repository, under `/tmp/qwbe-t1425/screenshots`.

**The invoice register, the invoice and correction detail screens and the PDF/XML
downloads have since been driven in a real browser too**, against an isolated fixture
that seeds one issued invoice and one correction of it through the public API. The pass
checked: unlock with the fixture token; the register listing both documents; the kind
and search filters; the invoice detail and the correction detail; the invoice PDF
download (rendered by `POST` then fetched) and both e-Factura XML downloads; the signed
totals on the correction; a full page reload while authenticated; logout; and the
register at a 320 px viewport. No unexpected JavaScript console errors were observed.
Screenshots are kept outside the repository: the final pass is archived under
`/tmp/qwbe-t1400-registry/browser-evidence-final`, together with its screenshots.

The two defects that pass found — a missing document answered with the backend tag
`ResourceNotFound` printed verbatim, and a failed detail load offering no way to ask
again — are fixed and **have since been re-driven in a real browser**. That final pass,
over the same isolated fixture, checked: every route at desktop and at a 320 px
viewport, with no horizontal overflow; the emitter block naming counties in words
rather than ISO codes, `Cod TVA RO<cui>`, the share capital in RON and the e-Factura
status as `Netrimisă`; the fixture-only non-VAT document displaying `Scutit TVA
art. 310`; a missing document answered with the localized message; a detail load
failing with `500`/`502` and recovering through **Reîncearcă**; and a real PDF download
through the browser's own, uncontrolled download path. Logout leaks nothing: a stale
download whose `200` arrived only after logout produced **zero** download events. No
unexpected JavaScript console error was observed anywhere in the pass.

The register's own retry **passed** its browser check too. A first-page `502` is recovered
by **Reîncearcă**: the refetch restores both rows. A `502` on the next page keeps the row
already loaded, and **Reîncearcă** on that failure calls `fetchNextPage`, appending the
second row without duplicating or discarding anything. A `404` is not transient and offers
no retry at all. Browser MCP verified each case through the DOM and the network log in the
final pass, with zero unexpected JavaScript console errors. The preview stays opt-in
because the rest of T-1400 — issuer settings, payments — is not migrated or cut over,
**not** because retry is unchecked.

One honest limitation: the retry phase split is currently covered by a temporary observer
probe plus this browser pass, not by a permanent hook regression test (non-blocking,
Fable LOW).

The same pass reported an apparent early session expiry. It was **not reproduced**: the
browser session lives 30 days (`sessionLifetimeSeconds`, `standalone/auth/browser-session.ts`),
the proxy forwards `Max-Age` unchanged and validates rather than shortens it
(`frontend/src/lib/server/proxy-cookie.ts`), and the only fixture route that answers
`401` belongs to the stub API used by `probes/frontend-runtime.mjs`, which the browser
fixture does not go through. No change was made for it.

## Authoring and drafts (T-1400 phase two)

- Authoring reads (issuer, series, units, VAT regimes, customers, product presets) go through
  a reference client built from the session's transport; the issuer answers `404` → `null` →
  an "issuer-required" state, not an error. Customers and presets page by cursor with explicit
  "load more" — no silent 200-row cap.
- Saves are orchestrated by a pure controller (`lib/invoice-draft-save-controller.ts`): create,
  then header, then one line at a time, server IDs retained after each confirmed answer, every
  chained write preceded and every answer followed by a session-ownership check. A lost answer
  on a known draft is reconciled against a fresh read before anything is re-sent; an
  unattributable outcome blocks the save with an explicit "rezultatul salvării nu este
  confirmat" notice instead of risking a duplicate line, and points at the drafts list for
  reconciliation. A lost answer on the initial create blocks resubmission for the same reason.
- Issuance (`lib/invoice-issuance-controller.ts`) goes straight to `POST /invoices` for an
  unsaved document, or reads the saved draft fresh and compares the full intent
  (`authoringPayloadMatchesDraft`) before `POST /drafts/{id}/issue`. The idempotency key
  (`lib/operation-idempotency.ts`, per operation + canonical payload fingerprint) is kept
  across a lost answer and across a draft already reading `issued`, so a legitimate replay is
  never blocked; the legacy `idempotency-key.ts` (which reset on any `5xx`) is deliberately
  **not** ported.
- The series is chosen before the first save and read-only afterwards (`UpdateDraftInput` has
  no series). The due date is optional in a draft and required at issuance only when the
  fiscal total rounds positive. Issued invoices are immutable; a draft already issued (or
  issued as a proforma in the legacy app) renders a notice pointing at the registry that
  actually holds the document — `/invoices`, or `/proformas` since phase three. A draft derived
  from a proforma stays editable and issuable but cannot be deleted.
- The buyer is a saved customer or a one-time party (B2B/B2C, manual CUI/CNP validation, no
  CUI lookup), TVA rates resolve from the issuer's configurations on the document date, and
  lines saved under a rate the issuer can no longer charge are re-saved before issuance.
- Everything is tested with Node `--test` against the pure controllers, decoders and clients
  (no DOM): save/resume/lost answers, double-click single-flight, epoch/unmount guards,
  idempotency reuse rules, due-date rounding, stale VAT, concurrent-change comparison and
  the derived-draft restrictions. The BFF probe now also asserts `idempotency-key` header
  passthrough next to `x-csrf-token`.

**Gaps (not migrated in this phase):** CUI lookup/provider integration, document-series
CRUD, issuer settings, payments, storno authoring, CUI T-1371, and a
real-browser pass over the new screens (supervisor delegates that separately). The
register/drafts browser pass and the `/invoices/new` vs `/invoices/[id]` route precedence
remain to be verified in a browser. Proforma screens are migrated — see below.

## Proformas (T-1400 phase three)

Migrated routes: `/proformas` (cursor-paginated register), `/proformas/[id]` (document) and
`/proformas/new` (authoring). The shell navigates to all three; no proforma link is dead.

- A proforma is **not** a fiscal document: downloads are PDF only, there is no e-Factura
  section anywhere on the detail screen, and the authoring screen says so next to the save.
- Authoring is one request (`POST /api/proformas`) over the shared authoring modules
  (issuer/VAT/units/customers/presets, buyer editor, lines editor). There is no draft and no
  issuance step, so the whole document — series included — is chosen before the single save,
  and the save is confirmed in a dialog because the number and the document become immutable
  the moment the server answers. A positive proforma left without a due date is legal and
  saveable, with a note saying it will then only convert into a *draft* invoice.
- Blocking prerequisites are the issuer, the VAT catalogue and the unit catalogue, derived
  purely (`lib/proforma-authoring-page.ts`). A missing proforma series is **not** blocking: the
  form opens with a setup note beside a closed save.
- Conversion lives on the detail screen: to an issued invoice (needs a due date) or to a draft
  invoice, each under `ConvertProformaInput = { invoiceSeries }` with the invoice series
  catalogue filtered to `documentType === "invoice"`, issuance explicitly confirmed. The single
  conflict code `proforma_already_converted` is surfaced as a state, not as a failure.
- Every write (save and both conversions) claims its idempotency key in the shared operation
  recovery journal *before* the request, under `create-proforma` /
  `convert-proforma-invoice` / `convert-proforma-draft`; a lost answer keeps the key for a
  replay and, on the authoring screen, closes the form and points at `/proformas` instead of
  offering a second save under a new key.
- Tested with Node `--test` against the pure layers (page state, readiness, save controller,
  conversion derivation and error classification, register projection and decoders); no DOM.

## Master data — products and customers (T-1400 phase four)

Migrated routes: `/products` (the product catalogue, canonical in
`standalone/http/ui-routes.ts` — not `/product-presets`) and `/customers` (the customer
registry). Both shell links are now live; `/settings` is still absent.

- Master-data writes live in their own client (`lib/registry-client.ts`), separate from the
  read-only reference client. They carry **CSRF only**: the backend requires no idempotency
  key for them (`standalone/api/http-endpoints-master-data.ts`), there is nothing to replay,
  and a duplicate created by a repeated request is deletable — unlike an issued number. So
  none of the operation-recovery machinery is wired to them, deliberately.
- Each screen is a registry on the left and an editor on the right. What may be saved and
  which single field refuses it are pure modules (`lib/product-preset-form.ts`,
  `lib/customer-form.ts`, `lib/customer-payload.ts`), so the rules are tested without a DOM
  and the components only place the message the model named.
- The preset VAT rules are ported as functions (`lib/product-preset-vat.ts`): only taxable
  rates in force may be preferred (article 310 is a status of the issuer, never of a
  product), a preference that has expired keeps an option of its own labelled `(expirată)`
  and blocks the save until it is replaced. The legacy assertions that went through markup
  are now assertions on those functions.
- Customer validation reuses the modules the authoring buyer already goes through
  (`normalizeRomanianCui`, `romanianCuiPattern`, `countyRequiresSector`,
  `isRomanianCountyCode`): a CUI keeps its digits without the `RO` prefix, a CNP is 13
  digits or empty, and a sector exists for Bucharest alone — switching the county drops it
  so a stale sector is never sent with another county's address.
- There is no global toast in this frontend: each screen keeps its own notice
  (`lib/registry-feedback.ts`) next to the panel that changed, and a deletion is confirmed
  with the sentence that states the fact — documents already issued keep their own copy and
  do not change.
- The rates are resolved on the browser's own date (`lib/format.ts` `today()`), which is
  what authoring already does, rather than on a second notion of "today"; the legacy screen
  used `todayIn("Europe/Bucharest")`.
- Focus follows the record that opens: the editor owns the ref and moves the keyboard to its
  heading through `hooks/use-editor-heading-focus.ts`. That effect is the only one on either
  screen, and it does what an effect is for — a DOM action after a render.

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
