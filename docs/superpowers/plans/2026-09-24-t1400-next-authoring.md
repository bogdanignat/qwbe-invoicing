# T-1400 Next invoice authoring + drafts — plan aprobat (Bogdan, «ok, go...pe un singur branch pls»)

Branch: `feat/T-1400-next-authoring` (base 99fd137). Review plan Fable: REVISE → corecții
integrate mai jos (ref: /tmp/plan-review.xP1Aju/fable.md). Test-after. Fără backend/CLI nou,
fără CRUD masterdata, fără CUI lookup, fără proforme UI, fără SSR forms.

## 1 Contracte/adapters `frontend/src/lib`
- `draft-models.ts` (tipuri Draft/DraftLine/Customer/Issuer/VatCatalogue/Series/UOM/Preset +
  inputs Create/Update/DraftLine/AuthoringDocument), `draft-decoders.ts` (decodeDraft/Page,
  Customer/Page, Preset/Page, DocumentSeries, UOMs, Issuer, VatCatalogue, Deleted; reuse
  `decodeAddress/decodeBuyer/decodeUnitOfMeasure` exportate din `document-snapshot-decoders.ts`
  + `model-decoder.decodePage`; reuse `decodeIssuedInvoice` pentru issue).
- `drafts-client.ts` + `authoring-reference-client.ts`: factory `(transport: BrowserTransport)`,
  integrat în `hooks/use-invoicing-clients.ts`. Read: `signal`; write: `csrfToken: string`;
  issue: `+ idempotencyKey`. Issuer 404→null. Customers/presets cursor paged ≤200 cu
  `useInfiniteQuery` + load more (niciun plafon 200 tăcut).
- `require-csrf.ts`: helper fail-fast extras din `use-document-detail.ts`.

## 2 Logică pură authoring `frontend/src/lib/invoice-authoring-*.ts`
- Port model/transitions/options/payload/readiness/workflow/notes/positive-total +
  `vat-defaults.ts` (vat-selection + vat-snapshots). Fără import web/backend.
- Serie readonly după primul save (UpdateDraftInput fără series). Scadență optional la draft,
  obligatorie la emitere doar dacă total fiscal rotunjit pozitiv (`positiveInvoiceRequiresDueDate`).
- `authoringAccess`/`draftDeletionState` fără href `/proformas`: doar notice + `/invoices`.
  Issued immutable; derived (sourceProformaId) editabil+emisibill, nu delete.

## 3 Controllere pure (node:test) `frontend/src/lib`
- `operation-idempotency.ts`: port `createOperationIdempotency` (cheie per operație+fingerprint;
  reuse la network/408/5xx; reset la success/4xx≠408/payload nou). Legacy `idempotency-key.ts`
  NU se portează.
- `invoice-draft-save-controller.ts`: save serial create→header→linii; server IDs reținute după
  fiecare succes; resume fără pierdere modificări locale/refetch. Non-idempotent writes: fără
  retry orb. Unknown createDraft outcome → avertisment «rezultatul salvării nu este confirmat»,
  resubmit blocat, întoarcere/refetch drafts pt reconciliere manuală. Draft cunoscut → GET fresh
  + comparație cu intenția înainte de resume; ambiguu → recovery explicit, fără duplicate.
  Delete line local (unsaved) vs server (saved). Single-flight toate mutațiile, fără retries
  automate. Epoch + ownership verificate înainte de fiecare write din lanț și după await înainte
  de cache/navigation/state/errors. Abort la logout/unmount; epoch nou fără efecte vechi.
- `invoice-issuance-controller.ts`: fără draft → POST /invoices direct; cu draft salvat →
  GET fresh + `authoringPayloadMatchesDraft` → POST /drafts/id/issue. Retry issue idempotent
  chiar și cu răspuns pierdut; fresh-check nu blochează replay legitim (draft deja issued →
  replay cu aceeași cheie, server idempotent). Success: invalidate invoiceRegister + drafts +
  invoice/[id], navigate la id real, evict draft — toate gardate de ownsEpoch. Confirm
  window.confirm.

## 4 Hooks subțiri `frontend/src/hooks`
- `use-invoice-authoring-{page,session,draft}.ts`, `use-invoice-issuance.ts`, `use-drafts.ts`,
  `use-operation-idempotency.ts`. `enabled: authenticated` + signal; useMutation callbacks
  gardate explicit (rulează și după unmount). Page states: loading/error/retry/issuer-required/
  vat-empty/series-required/units-empty/missing/locked/ready; setup lipsă explicat fără link
  inexistent. Save known draft `setQueryData` guarded. Issue success: navigate actual id.

## 5 UI dumb
- `components/ui/{Field,Input,Select,Textarea}.tsx` pe tokens CSS existenți + Button/AsyncState/Page.
- `components/authoring/*` (BuyerEditor, InvoiceAuthoringHeader, InvoiceLinesEditor,
  InvoiceLineRow, AuthoringActions) + `views/{InvoiceAuthoringView,DraftView}.tsx`; o componentă
  per fișier, fără any, cap 6000/fișier.
- `app/invoices/new/page.tsx`, `app/drafts/[id]/page.tsx`, PrivateScreen. `/invoices`: CTA
  „Factură nouă” în Page.actions + secțiune drafturi cursor paged cu open/delete confirm +
  stări independente; registru/filtre/paginare nemodificate. Focus + 320/390px.

## 6 Test-after + probe + docs
- node:test pure: decoders/contracts, paginare cursor >200, save/partial/lost responses fără
  duplicate, due-date zero/positive/draft, TVA stale, concurrency comparison, derived
  restrictions, issue retry same key/payload schimbat/doubleclick, late save/issue/delete după
  logout/unmount/reauth fără writes/cache/navigation. Extend `probes/frontend-runtime.mjs` cu
  passthrough `idempotency-key` (+ contract real BFF dacă fezabil). `pnpm verify` complet +
  `git diff --check`. `docs/NEXT_PREVIEW.md` milestone + gaps exacte. Fără browser aici.

## Progres
- [x] Context citit: CLAUDE.md, rules INDEX, cache react19, react-patterns ref, plan review Fable
- [x] Pas 1: lib contracts/decoders/clients + require-csrf + export decoders comuni
- [x] Pas 2: logică pură authoring portată (7 fișiere + vat-defaults/vat-snapshots)
- [x] Pas 3: controllere pure (operation-idempotency, draft-save + reconciliation, issuance)
- [x] Pas 4: hooks (page/session/draft/issuance/drafts/idempotency)
- [x] Pas 5: UI (ui primitives, authoring components, views, routes, /invoices CTA + drafts)
- [x] Pas 6: teste pure (173 frontend lib tests) + probe idempotency-key + NEXT_PREVIEW
- [x] pnpm verify verde (exit 0; log: /tmp/t1400-verify4.log) + git diff --check curat
- [x] Review Fable (`/tmp/react-review.OSabY4/review.md`, changes_requested): toate cele 8
  findinguri (1 high, 4 medium, 3 low) verificate pe cod curent — HIGH (issuance blocat de
  unconfirmedMessage), MED (controller `useState` nu `useMemo`), MED (`useDrafts` reuse
  controller + reconciliere 404), MED (guard derived-draft mutat în controller), MED (lost
  issue păstrează payload+cheie, refuză payload editat), LOW (Next `Link`, primitive
  `Button`/`LoadMore`, snapshot client existent-draft, retry per-sursă) sunt deja implementate
  în working tree, cu teste node:test dedicate (`invoice-draft-save-recovery.test.ts`,
  `invoice-issuance-controller.test.ts`, `use-drafts.test.ts`). `network-all.log` deja mutat
  de supervizor în `/tmp/qwbe-t1400-authoring-browser/`, nu mai e la root.
  **Neverificat în această sesiune:** execuția oricărei comenzi (`node`, `pnpm`, `npx`, chiar
  `bash -c`) a fost respinsă de sandbox cu „This command requires approval” — inclusiv comenzi
  read-only prin `node`/`pnpm`; doar utilitare shell (`git status/log/diff`, `ls`, `find`,
  `grep`) au funcționat. `pnpm verify` nu a putut fi rerulat proaspăt; verificarea de mai sus e
  strict pe citire de cod + teste existente, nu pe rulare. `git diff --check` a rulat curat
  (fără output).
