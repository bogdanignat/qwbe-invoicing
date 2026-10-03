# Next frontend preview — T-1400, phase one

> **T-1400 phase two (this branch, `feat/T-1400-next-authoring`):** invoice authoring and
> drafts are now migrated. `/invoices/new` authors a new invoice or draft,
> `/drafts/[id]` resumes one, and `/invoices` gained a "Factură nouă" CTA plus a cursor-paged
> drafts section. See the **Authoring and drafts** section below for the design notes and the
> exact gaps that remain. The existing Vite UI remains operational; nothing is cut over.

The new `frontend/` package is an opt-in application in the existing pnpm workspace.
It provides the unlock screen, session restore/logout, and the invoice register with
the invoice and correction document screens. **The one remaining business screen —
payments — is not migrated yet** (issuing, drafts, proformas, the product catalogue,
the customer registry and the issuer settings are, in the phases described below).
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
because the rest of T-1400 — payments — is not migrated or cut over,
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

**Gaps (not migrated in this phase):** CUI lookup/provider integration, payments, storno
authoring, CUI T-1371, and a
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
registry). Both shell links are now live; `/settings` followed in phase five, below.

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

## Issuer settings and document series (T-1400 phase five)

Migrated route: `/settings` — the issuer profile (identity, address, legal and fiscal
fields, branding, VAT regime) and the document-series card. The shell link is now live,
so no navigation entry is dead.

- The profile is one `PUT /api/issuer` that replaces it whole, and one
  `POST /api/document-series` that adds a series. Both carry **CSRF only**, like the rest
  of the master data: the issuer is a profile, and a repeated series `POST` answers
  `document_series_exists` rather than creating a duplicate. They live in
  `lib/settings-client.ts`, apart from the read-only reference client an authoring session
  goes through — that client must not be able to rewrite the issuer.
- The form is held as data (`lib/issuer-form.ts`) and validated as a value
  (`lib/issuer-payload.ts`, `lib/issuer-legal.ts`): the legacy screen was an uncontrolled
  `<form>` read at submit and remounted by a changing `key` after each save, with the DOM
  as arbiter between the typed fields and the saved answer. Each rule now answers with the
  single field that refuses the save, in the reading order of the form, and the screen's
  only job is to move the keyboard there.
- The VAT regime is the only part of the history that may be edited: `vatConfigurations`
  and `currentVat` are answers, `vatChange` is the only way to move the regime, and the
  screen shows the periods read-only (`lib/issuer-vat-regime.ts`). Which regime the form
  opens on is projected from the stored configurations against one single day
  (`lib/issuer-vat-baseline.ts`), never from the server's cached `currentVat` snapshot,
  which can be a day older than the screen's own `today`. A regime that is merely scheduled
  or already expired is named as such instead of being reported as the current one, one
  that cannot be read at all is declared unreadable and blocks the save until the checkbox
  is answered, and an unsaved choice says it was chosen manually rather than describing the
  profile. There is no non-VAT basis field: article 310 is the one basis the schema accepts.
- Branding is validated in the browser before it is sent — PNG/JPEG by signature and not
  only by declared type, at most 256 KiB, at most 2048 px per axis and 4 megapixels, which
  are the backend's own limits — and the backend answers the re-encoded PNG with its
  dimensions (`lib/branding-decoder.ts`, `lib/branding-image-file.ts`,
  `lib/issuer-branding.ts`). An object carrying neither text nor image is not sent: "no
  branding" is `null`.
- The two slow answers on this screen are filtered by a revision guard
  (`lib/revision-guard.ts`, `lib/settings-revisions.ts`): a logo that finishes decoding
  after a second file was chosen, or after the form was edited, is dropped instead of
  replacing the preview; a save answer replaces the form only if nothing was typed while it
  was in flight, and otherwise keeps the edits and says so. The rules are values over the
  guard, so both races are tested without a component, a DOM or a timer.
- The two help texts are a native `<dialog>` opened with `showModal()` — the focus trap and
  the `Escape` behaviour are the platform's — and the keyboard returns to the button that
  opened it on close (`hooks/use-help-dialog.ts`).
- Tested with Node `--test` over the pure layers: branding decoding and image validation,
  payload preservation and the refusal order, the legal-field rules (trade registry, IBAN
  mod-97, social capital, bank name), the VAT baseline/selection/status/history, the races,
  and the series validations including the duplicate per document type. No DOM.

### What the stage review changed (2026-09-25)

The screen was reviewed after it was built and came back `changes_requested`. What the
review found, and what was done about it:

- **The form edit read the rendered form, not the queued one.** `edit()` called
  `setOverride(next(form))` with the `form` captured while rendering, so two `onChange`
  in one React batch — which is what a browser autofill of an address is — both started
  from the same saved profile and the last one silently overwrote the first: city, street
  and postal code filled in one gesture, only one of them kept. The base is now the queued
  state (`lib/issuer-form.ts`, `editedIssuerForm`), as the series card already did. The
  fold is a pure function, so the batch is a test rather than a thing to try in a browser:
  three patches applied as React applies them, all three survive.
- **A refused logo did not mark the control.** `role="alert"` announces the sentence once,
  when it appears, and says nothing to someone who tabs back to the input afterwards. The
  file input is now `aria-invalid` and describes itself by that message for as long as it
  stands, next to the hint — which is what the legacy screen did.
- **The VAT history heading was rendered over an empty table.** A profile with no regime
  yet showed "Istoric regim TVA" and nothing under it; the heading now belongs to
  `IssuerVatHistory`, which renders nothing at all when there is no history.
- **The file revision guard was rebuilt on every render.** `useRef(createRevisionGuard())`
  keeps the first guard and throws away one per render; it is now
  `useState(createRevisionGuard)`, the same single instance the edit guard already used.
- **`dismissNotice` was a public method nobody called**, and the "saved" notice outlived
  the edits that followed it. It is now called from `edit()`, so the notice goes with the
  next keystroke, as on the series card.
- **"Elimină tot brandingul" was missing.** The legacy screen dropped text and logo in
  one action; the new one only removed the logo and left the text to be cleared by hand.
  Restored as a single model action (`clearBranding`), with "Elimină sigla" kept.

### What the second review changed (2026-09-25)

- **The VAT regime was read from two different days at once.** The first round rejected
  the unrecognized-regime finding by enumeration: every sequence of up to three VAT
  changes — 4369 states, 258 with `currentVat` null and configurations present — produced
  a recognized regime or fallback, none undefined. That enumeration held one date constant
  on both ends, and that is exactly the assumption that fails. `currentVat` is a snapshot
  the server computes when it builds the answer
  (`cube/invoicing/issuer/application/issuer-view.ts:14`), the query client keeps it with
  no `staleTime` and no refetch on focus (`hooks/use-app-query-client.ts:7`), while the
  form's `today` is recomputed on every render. A tab left open across midnight holds
  yesterday's regime and today's date — and with a registration that was scheduled for
  today, the screen said "neplătitoare" over a VAT-registered issuer, so a save about any
  other field would have written an article 310 exemption nobody asked for.
  The snapshot is no longer read by this screen. The regime in force is projected from the
  stored configurations against the same `today` as the fallback and the change date
  (`lib/issuer-vat-baseline.ts`, `currentVatRegistration`) — the same projection the
  backend performs (`cube/invoicing/issuer/domain/vat-regime.ts:18`) — so both ends answer
  about the same day by construction. That covers the cached-null regime that came into
  force overnight and the cached regime that expired overnight, in one rule rather than in
  a branch per case.
- **And what cannot be read is no longer guessed.** A saved profile whose configurations
  name no regime today and no scheduled or expired neighbour is `kind: "unknown"`: the
  status line says the regime cannot be determined and that nothing is assumed, and the
  save is refused on the checkbox until it is actually answered. Nothing is auto-corrected
  and no tax is changed by the screen. An issuer that has never been saved is unaffected —
  `GET /api/issuer` answers `404`, and an unticked checkbox there is the default offered to
  a new profile, not a regime imposed over stored ones.
- **Branding actions left stale notices and a stale refusal behind.** The first round
  cleared the "saved" notice from `edit()`, which the typed fields go through; choosing a
  logo, "Elimină sigla" and "Renunță la fișierul respins" do not. The branding hook now
  reports every one of those as an action (`hooks/use-issuer-branding.ts`), and the settings
  model answers all three the same way: the notice and the refusal that described the
  previous state are dropped with them.
- **The keyboard was dropped by the destructive branding controls.** "Elimină sigla",
  "Elimină tot brandingul" and "Renunță la fișierul respins" unmount as the effect of
  their own click, leaving focus on `document.body`. The same two non-select actions move
  it to the file input, through the helper the refusal focus already uses
  (`lib/focus.ts`, `focusRegistryField`).
- **`branding` was optional on the model and tolerated as missing by the decoder.** The
  contract sends it on every answer (`standalone/api/schema-issuer.ts:51`), only nullable.
  It is now `readonly branding: IssuerBranding | null` and an absent field throws at the
  boundary like every other required one; the fixtures that relied on the tolerance supply
  `branding: null`.

One finding was investigated and **not** changed:

- **The save-while-editing branch.** Every control is `disabled` while the save is in
  flight — the file input included — and the submit is blocked while an image is being
  decoded, both by the button and by the model. So `ISSUER_SAVED_WHILE_EDITING`
  (`lib/settings-revisions.ts:45`) cannot be reached from the UI at all: not by typing, and
  not by the logo either, which the first round claimed. It is covered as a value
  (`settings-revisions.test.ts:52`). That is a real limit of the coverage, not a defect,
  and it is left as it is.

### Browser evidence

Two passes exist, and they describe two different screens. The **final** one below is the
evidence for this phase; the earlier one is kept as history.

**Final pass — post-fix, 2026-09-25, PASS (14/14).** `/settings` was re-driven in a real
browser on the isolated preview fixture (`compose.preview.yaml`,
`http://invoicing-next.localhost:3181`) after both rounds of fixes above, on this branch.
Report and screenshots: `.playwright-mcp/t1400-stage-c-final-browser.md`,
`.playwright-mcp/t1400-stage-c-final-refused.png`, `t1400-stage-c-final-320.png`,
`t1400-stage-c-final-390.png`, `t1400-stage-c-final-desktop.png`. What it covered, step by
step, is the hunks those rounds added:

- **The batched address.** Locality, street, county, postal code and bank name filled in one
  gesture, saved, reloaded: every value persisted — the queued-state fold read in a browser,
  not only as a value.
- **Branding, refusal to removal.** A text file named `.png` refused by signature leaves the
  file input `aria-invalid="true"` and `aria-describedby` pointing at the refusal for as long
  as it stands; a valid retry clears both the refusal and the stale "saved" notice; a new
  logo chosen after a save drops that notice too. "Elimină sigla", "Elimină tot brandingul"
  and "Renunță la fișierul respins" each returned the keyboard to the file input
  (`document.activeElement` asserted), and the first two survived save and reload — logo
  gone with the brand text kept, then both gone.
- **The help dialog.** `showModal()` (`:modal` matched), focus on the close control, `Escape`
  closes, focus returns to the "ⓘ Ajutor pentru câmpuri" button that opened it.
- **Mobile.** 320 and 390: `scrollWidth === innerWidth`, no horizontal overflow.
- **The two VAT regressions, as mocks rather than as a clock.** `GET /api/qwbe/issuer`
  answered with `currentVat: null` and configurations active today — the cached-null
  snapshot over a registration that came into force overnight — and the screen projected the
  regime correctly: checkbox ticked, "plătitoare de TVA", one history row. With
  `currentVat: null` and no configurations at all, the unknown-regime guard held: the status
  says the regime cannot be determined and nothing is assumed, and the save produced **zero
  `PUT` requests**, with `aria-invalid` and the issue message on the checkbox. Mocks were
  unrouted and the real fixture state read back afterwards.

Console: the only error is the expected `401` on `/api/qwbe/session` during pre-login
probing. Zero uncaught JS.

**Still untested either way** (unchanged, and none of it is covered by the final pass): a
JPEG upload, the 2048 px / 4 MP rejections (only invalid content and the byte limit were
exercised), a native file chooser (files were injected as `input.files` via `DataTransfer`),
and a real crossing of midnight (the host date was never moved — the projection is covered as
a value in `issuer-vat-baseline`). The series card was not re-driven in the final pass; it
stands on the earlier one.

**Earlier pass — pre-fix, historical.** Before either round of fixes, `/settings` was driven
on the same fixture: login, identity/address save and reload, an invalid CUI refused by the
backend and shown, the VAT regime saved and read back in the history, a valid logo uploaded
and persisted, a file refused by signature and one refused by size, a series added and its
duplicate refused inline, the help dialog's focus trap and focus restoration, a mocked `500`
on `PUT /api/issuer` surfaced as an error, and 320/390/1280 without horizontal overflow.
Pass, no blocking defect (`.playwright-mcp/t1400-stage-c-browser.md`). It describes the
pre-fix source, and its screenshot is of that source; it is the only evidence for the series
card and for the mocked `500`. Not covered by it either: a save with a logo and no brand
text, and a `4xx` on `POST /api/document-series`.

**Gates and re-review.** The supervisor ran the full `pnpm verify` chain over the current
tree: 1107 tests pass and 8 standalone-runtime tests pass, `fail 0`, `skipped 0`, `todo 0`,
boundaries clean (753 modules), `EXIT=0`. The stage re-review came back **pass** with no
blocking finding and no new fix applied: three `low` and one `info` are recorded as
follow-ups — a backdated `vatEffectiveFrom` silently replacing later stored VAT periods
(no confirmation guard on the front end), the art. 310 sentence on `IssuerVatFields` that
contradicts the new guard's copy for a new profile, `brandingActions` untested because it
lives in a `"use client"` hook rather than in `lib/`, and the unknown-regime checkbox
rendering unticked instead of indeterminate.

**Gaps:** payments, the CUI lookup (T-1371 — the CUI is typed and validated, never fetched),
series deletion/renaming (add-only by design: a series that has numbered a document cannot
be renamed without breaking its numbering), and the four follow-ups above. The browser pass
and the re-review have both landed; this phase is built, verified and accepted.

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
