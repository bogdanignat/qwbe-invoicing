# Plan T-1400 — migrare ultimele ecrane legacy → Next (invoicing-qwbe)

Plan revizuit după plan-review (executor Opus, REVISE — corecții adoptate). Etapa D: INCLUSĂ (decizie Bogdan 2026-09-25).

Branch: feat/T-1400-next-final-screens, checkout principal, bază main 24580b8.

Repo: /home/bogdan/projects/invoicing-qwbe, main 24580b8 (curat). Branch nou:
`feat/T-1400-next-final-screens`, creat în checkout-ul principal (fără worktree).

## Context verificat
- Migrat deja în Next: unlock, invoices (register + detail), corrections (detail),
  drafts, authoring facturi (PR41-43).
- Legacy rămas în `web/src/views`: ProformasView, ProformaDetailView,
  ProformaAuthoringView, ProductPresetsView, CustomersView, SettingsView.
- NEMIGRAT în plus față de cele 6 ecrane: `PaymentPanel` + `CorrectionPanel`
  (`web/src/components/invoice/`, montate la `web/src/views/InvoiceDetailView.tsx:22`);
  Next are doar `DocumentDetail` (`frontend/src/views/InvoiceDetailView.tsx:8-14`).
  Deci cutover-ul cere și Etapa D (mai jos). `POST /api/drafts/{id}/proformas` există
  pe backend dar nu e folosit de niciun ecran legacy → rămâne nefolosit.
- Rute canonice (`standalone/http/ui-routes.ts:9-15`): `/proformas`, `/proformas/new`,
  `/proformas/[id]`, `/customers`, `/products` (NU `/product-presets`), `/settings`.
- Backend: toate endpoint-urile necesare există și au teste HTTP —
  `/api/proformas` (+`/{id}`, `/{id}/invoice`, `/{id}/draft-invoice`, `/{id}/pdf`),
  `/api/product-presets` CRUD, `/api/unit-of-measures`, `/api/vat-regimes`,
  `/api/customers` CRUD, `/api/issuer` GET/PUT, `/api/document-series` GET/POST.
  Scrierile de proformă cer `idempotency-key` OBLIGATORIU
  (`standalone/api/http-endpoints-fiscal.ts:28-31`); scrierile de master-data cer doar
  CSRF (`http-endpoints-master-data.ts:19-26`). ZERO backend changes.
- BFF nu se schimbă: catch-all acceptă toate metodele
  (`frontend/src/app/api/qwbe/[...path]/route.ts:8-14`), forwardează `x-csrf-token` și
  `idempotency-key` (`frontend/src/lib/server/proxy-headers.ts:51`), cap body 1 MB >
  256 KiB max branding (`standalone/api/branding-normalizer.ts:7`).
- Pattern Next: `app/**/page.tsx` server component tipat (`PageProps<"/...">`) →
  view client component din `frontend/src/views/`, `useAuthenticatedShell` +
  `PrivateScreen`, clienți construiți din transportul sesiunii
  (`frontend/src/hooks/use-invoicing-clients.ts:21-35`), logică în hooks/lib cu teste
  `node:test` colocate. Nu există teste de randare în `frontend/src`.
- Idempotency în Next (post-T-1451) NU e `useOperationIdempotency` (nu există): e
  jurnalul cu slot unic (`lib/operation-recovery-journal.ts:57`), uniuni închise
  (`lib/operation-recovery-types.ts:10,26`), titluri exhaustive
  (`lib/operation-recovery-view.ts:40`), replay (`lib/operation-replay.ts:22`).
- Cap 6000 code chars/fișier pe `frontend/src` (`qwbe.config.json`, `probes/size-gate.mjs`).
  Fișiere deja aproape de cap, deci NU pot fi extinse: `authoring-reference-decoders.ts`
  5943, `use-invoice-authoring-session.ts` 5891, `document-projection.ts` 5737,
  `invoice-authoring-transitions.ts` 5625, `use-invoice-authoring-page.ts` 5465.

## Etapa 0 — seam-uri partajate (înainte de orice ecran)
1. Extinde jurnalul de recuperare pentru proforme, într-un singur pas coerent:
   `RecoveryOperation` += `create-proforma`, `convert-proforma-invoice`,
   `convert-proforma-draft`; `RecoveryRequest` += kind-urile corespunzătoare;
   decoder actualizat; `OPERATION_TITLE` (Record exhaustiv → eroare de compilare dacă
   se uită); `ReplayClient`/`ReplayOutcome` += replay pentru proformă și pentru
   documentul rezultat din conversie; mesajele `BLOCKED_*` reformulate ca „registrul de
   facturi și proforme". Dacă `operation-recovery-types.ts` (5393 bytes) sau
   `operation-recovery-view.ts` depășesc capul, se sparg în fișiere per familie.
   Slotul rămâne unic: o proformă nerezolvată blochează scrierile de factură și invers —
   comportament intenționat, verificat în test.
2. Parametrizează ce e azi hard-codat pe factură: `authoringSeriesOptions`
   (`lib/invoice-authoring-options.ts:4-8`) primește `documentType`; `AuthoringAccess.registryHref`
   (`lib/invoice-authoring-model.ts:50-58`) devine `"/invoices" | "/proformas/..."`;
   `draftDeletionState`/`DERIVED_DRAFT_DELETE_REFUSED` (`lib/invoice-authoring-workflow.ts:4-6`,
   `lib/draft-save-types.ts:75`) trimit spre proforma-sursă, nu spre „aplicația existentă";
   `LockedDraftReadonly.tsx:16` primește link către proformă.
3. Extrage din `invoice-authoring-*` părțile pe care le folosește și proforma
   (form model, linii, preset/customer apply, readiness) în module noi partajate —
   extragere, NU extindere a fișierelor de la cap. Se re-rulează testele existente ale
   fiecărui modul spart (`invoice-authoring-derived.test.ts`,
   `invoice-authoring-rules.test.ts`, `invoice-draft-save-controller.test.ts`,
   `invoice-issuance-controller.test.ts`, `operation-*.test.ts`).
4. `Shell.tsx`: cele 5 linkuri (Facturi, Proforme, Clienți, Catalog, Setări firmă) cu
   `aria-current` pe secțiunea curentă, ca în `web/src/components/layout/Shell.tsx:13-27`.
   Review react-review pe diff-ul acestei etape ÎNAINTE de a începe Etapa A —
   atinge cod deja migrat.

## Etapa A — Proforme
5. `/proformas` — listă cursor-paginată: client nou `proformas-client.ts` +
   `proforma-decoders.ts` (Proforma are `number`, `sourceDraftId`, `convertedInvoiceId`,
   `convertedDraftId` — nu se potrivește peste `IssuedInvoice`); hook pe pattern-ul
   `useAuthoringPagedList` / `use-drafts.ts`; componentă de registru + `LoadMore`;
   proiecție de status în `proforma-projection.ts` (pur, testat), CTA „Proformă nouă".
6. `/proformas/[id]` — detaliu: `decodeProforma` + `projectProforma` în fișiere noi,
   randat prin `DocumentDetail`; download PDF prin `DocumentDownloads` +
   `useDocumentDownload` (POST render, apoi GET bytes, ca `invoicing-clients.ts:54-57`);
   fără e-Factura (backendul nu expune pentru proformă). Secțiune de conversie proprie:
   serie de factură din `listDocumentSeries` filtrat pe `documentType === "invoice"`,
   regula „total pozitiv fără scadență → doar draft" (port din
   `web/src/hooks/proforma-hooks.ts:63,84`), stările `converted: invoice|draft|available`
   din `convertedInvoiceId`/`convertedDraftId`. Ambele conversii trec prin jurnal
   (Etapa 0) cu confirm explicit pentru emitere, ca `use-invoice-issuance.ts:135`;
   navigare prin `useRouter` + invalidare `invoiceRegisterQueryKey`, `draftsQueryKey`,
   `["proformas"]`, `["proforma", id]`. Teste: derivarea conversiei și clasificarea
   erorilor, pure.
7. `/proformas/new` — authoring proformă: sesiune proprie peste modulele partajate
   din Etapa 0 (customers/presets/VAT/unități), mutation `POST /api/proformas` cu cheie
   din jurnal (`create-proforma`). Module mici de la început: fiecare fișier nou sub cap;
   nimic adăugat în fișierele deja la 5.4–5.9K.
8. Stări de pagină: `loading` / `error` / `issuer-required` / `vat-catalogue-empty` /
   `unit-catalogue-empty` — derivare pură, testată; randare ca în
   `web/src/views/ProformaAuthoringView.tsx:9-14`.

## Etapa B — Catalog + Clienți
9. Client de scriere nou (`registry-client.ts`: create/update/delete pentru customers și
   product-presets, CSRF obligatoriu, fără idempotency-key) înregistrat în
   `use-invoicing-clients.ts`; clientul de referință rămâne read-only.
10. `/products` — CRUD preseturi + `unit-of-measures`; logica VAT a presetului portată
    din `web/src/lib/product-preset-vat.ts` ca modul pur testat (aserțiunile din
    `product-preset-vat.test.ts` devin teste pe funcții, nu pe markup).
11. `/customers` — split registry/editor ca în legacy, focus management păstrat
    (`useEffect` doar pentru focus DOM), validare CUI/județ/sector portată
    (`normalizeRomanianCui`, `countyRequiresSector`); notice local per ecran (Next nu are
    toast global), hook testat.

## Etapa C — Setări (se sparge în trei)
12. C1 — issuer identity + VAT: port `issuer-settings-state`, `issuer-address-state`,
    `issuer-details`, `fiscal-identity`, `vat-selection`, extragerea din formular
    (`issuer-settings-form`), revision guard; `PUT /api/issuer` cu CSRF.
13. C2 — branding: extinde modelul/decoderul Next cu `branding` (azi absent:
    `draft-models.ts:93-108`, `authoring-reference-decoders.ts:51` — fișierul e la
    5943 chars, deci decoderul de branding intră în fișier nou); validare client-side
    PNG/JPEG + max 256 KiB, ca `web/src/lib/issuer-branding.ts:55-62`.
14. C3 — `DocumentSeriesCard` (`GET`/`POST /api/document-series`) + help dialog
    (`<dialog>`, focus trap, port 1:1). Frozen-facts: nimic de schimbat pe backend —
    UI-ul doar afișează `vatConfigurations`/`currentVat` ca istoric, editabil e numai
    regimul curent cu `effectiveFrom`.

## Etapa D — paritate rămasă pentru cutover (decizie Bogdan: INCLUSĂ)
15. `PaymentPanel` + `CorrectionPanel` pe `/invoices/[id]` (endpoints existente:
    `listPayments`, `recordPayment`, `reversePayment`, `createCorrection`). Fie se
    include ca etapă, fie se deschide ticket separat — dar cutover-ul nu se poate
    declara „paritate ecran cu ecran" fără ea.

## Verificare (per etapă)
- `pnpm verify` complet (lint, typecheck, teste, build frontend, runtime probes,
  gate:package/test/size/boundaries). `gate:size` se rulează și după fiecare fișier
  nou mare, nu doar la final.
- Teste `node:test` colocate pe fiecare hook/lib nou; zero `.test.tsx`. Aserțiunile
  care în legacy erau pe markup (`proforma-detail-actions.test.ts`,
  `proforma-document-layout.test.ts`, `product-preset-vat.test.ts`,
  `proforma-authoring.test.ts`) devin teste pe funcții pure; ce rămâne acoperit doar
  de smoke se scrie explicit în raport.
- Browser smoke per ecran: desktop + mobile 320/390, auth flow, erori 4xx/5xx afișate,
  F5 în mijlocul unei scrieri (jurnalul trebuie să ofere retrimitere, nu al doilea document).
- Review react-review pe diff după fiecare etapă, Etapa 0 inclusă (executor Opus).
- `docs/NEXT_PREVIEW.md` actualizat în aceeași etapă cu ecranele migrate.

## Nu atingem
- Backend (endpoints există). Legacy Vite nu se șterge; cutover separat, după Etapa D.
- CUI T-1371 — după restul frontend-ului.
- `POST /api/drafts/{id}/proformas` — fără UI nici în legacy, rămâne nefolosit.
- Fără push/PR/deploy; commit doar la cerere explicită, prin wrapperul canonic.

## Risc
- Etapa 0 atinge cod deja migrat (facturi, drafturi, recovery). Ordinea e obligatorie:
  extragere + teste verzi înainte de orice ecran nou.
- Componente mari (SettingsHelpDialog 5.5K, CustomerEditorSection 4.6K bytes legacy) —
  fișiere separate, wrapper Next-specific propriu.
- Slotul unic de recuperare devine partajat între facturi și proforme: o operație
  nerezolvată blochează cealaltă familie. Comportament asumat, testat, explicat în UI.
