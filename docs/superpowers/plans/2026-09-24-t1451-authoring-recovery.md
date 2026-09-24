# T-1451 Authoring recovery — createDraft idempotent (plan acceptat)

Branch: `fix/T-1451-authoring-recovery` (base acbf0be). Review plan Fable integrat
(`/tmp/plan-review.YPZTRm/fable.md`). **Test-after** (suprascrie formularea test-first din plan).
Aprobat de Bogdan: crearea de draft primeste aceleasi garantii de idempotenta ca emiterea.
Fara migrare retro-compatibila: baseline-ul se editeaza in loc, baza de dev se recreeaza (CLAUDE.md).

## Problema
`POST /api/drafts` nu cerea `Idempotency-Key`. Un raspuns pierdut sau nedecodabil, urmat de retry
din UI, autora un al doilea draft. Liniile se adaugau abia dupa creare, deci un draft partial
ramanea in urma fiecarei incercari esuate.

## 1 Domeniu / contracte (`cube/invoicing`)
- `IdempotencyOperation` primeste `create_draft`; `resultKind` `draft` exista deja.
- `contracts/migrations.json`: CHECK-ul `operation IN(...)` din baseline include `create_draft`.
- `CreateDraftInput` primeste `lines?: ReadonlyArray<RawDocumentLine>` — un draft poate fi creat
  gol, cu zero linii sau complet intr-o singura cerere.
- Garda "cel putin o linie" pleaca din `drafts/application/authoring.ts` (partajat cu emiterea) in
  `issuance/application/snapshot.ts` `issuanceSource`, pe ramura de emitere directa. Ramura din
  draft o avea deja; `validateFiscalDocument` (calculation.ts) o mentine in adancime.

## 2 Operatia (`drafts/application/draft-creation.ts`, nou)
Model exact `proforma-draft.ts`: `findIdempotencyReplay` este primul lucru din tranzactie, inainte
de orice id sau `authorDocument`; header, linii, `saveIdempotencyRecord` si auditul comit impreuna
sau deloc. Replay returneaza draftul **curent** (editat sau emis). Draft sters ⇒ `DomainConflict
draft_creation_result_deleted`, niciodata recreare. Alt payload pe aceeasi cheie ⇒ `idempotency_key_reused`.
Extras din `draft-operations.ts` ca fisier separat pentru gate:size (cap 6000 chars/fisier).

## 3 HTTP (`standalone/api`)
- `DraftInput` primeste `lines?: Schema.Array(DraftLineInput)` (`DraftLineInput` ridicat deasupra).
- Endpoint: `conflict(notFound(validation(idempotentBody(...))))` **si** handler
  `errors("ValidationFailure", "ResourceNotFound", "DomainConflict")` — altfel `only()` din
  `api-failures.ts` transforma tagul nemapat in `internal_failure` 500.

## 4 Web legacy (compatibilitate callsite)
`draftsClient.createDraft(body, idempotencyKey)`; hook-ul de authoring foloseste
`useOperationIdempotency` existent, cheie stabila per intentie (payload), **niciodata uuid per retry**,
niciodata retrasa la esec. Creare header-only urmata de bucla existenta de linii (fara duplicare).
Pasul de creare extras in `hooks/draft-creation.ts`.

## 5 Verificare (test-after)
Domeniu 7 teste (`draft-idempotency.test.ts`), SQLite real 3 (`draft-atomicity.test.ts`: rollback,
concurenta pe aceeasi cheie, payload schimbat), HTTP 3 (`draft-idempotency-http.test.ts`: cheie
lipsa/malformata, linii in cerere + replay, 409 cu cod). Legacy: 1 test de stabilitate a cheii.
CLI: sarit justificat — se intareste o operatie existenta, nu apare workflow admin nou.

## Ramas (alti workeri)
- `frontend/` (Next): transport `createDraft` cu `idempotencyKey` + linii in cerere. **Neatins aici.**
- Validare live in browser pe fluxul de authoring; review de diff.

## Progres frontend (2026-09-24, worker continuare)

Facut in aceasta rulare (doar `frontend/`, fara commit):
- Reprodus si diagnosticat blocajul de 8 min: `invoice-issuance-controller.test.ts`
  „a second click while issuing changes nothing" facea deadlock — testul elibera
  promisiunea din `issueInvoice` dupa un numar fix de tick-uri de microtask, iar
  `guardDraft` a adaugat un `await` pe calea fara draft, deci `release` inca nu
  exista cand era apelat. Testul (si geamanul lui din save controller) folosesc
  acum un handshake explicit (`await sent`) — aserțiunile sunt neschimbate.
- Retintite 5 teste din `invoice-draft-save-recovery.test.ts` care exersau curse
  de linii pe calea de creare: dupa create-ul atomic nu mai exista bucla de linii,
  deci aceleasi curse se joaca acum pe un draft existent. Aserțiunile (numarul de
  `addDraftLine`, `getDraft`, `unconfirmed`/`aborted`) sunt neschimbate.
- Teste noi: `operation-recovery-journal.test.ts` (21), `operation-replay.test.ts`
  (12), `unreadable-answer.test.ts` (7), `authoring-lifetime-wiring.test.ts` (4).
  Acopera: intentia scrisa inainte de POST, replay same-mount/F5 cu request+cheie
  exacte, blocare reciproca save/issue si controllere duplicate, storage
  indisponibil/corupt/write fail/remove fail (fail closed), logout → marker fara
  payload si callback-uri stale care nu pot invia payload-ul, dismiss manual,
  document identic confirmat de doua ori → cheie noua, conflict fara rotire de
  cheie, replay care adopta starea serverului, UnreadableAnswer doar pe write.
- `use-operation-recovery.ts` rescris pe `useSyncExternalStore` + store nou
  `lib/operation-recovery-store.ts` (cache + subscribe + port singleton): lint-ul
  React semnala „Cannot access refs during render" si setState sincron in efect.
- Rupt ciclul `invoice-issuance-controller.ts` ↔ `invoice-issuance-types.ts`
  (`InvoiceIssuanceController` e acum interfata declarata, nu `ReturnType`).

Verificat: `node --test src/**/*.test.ts` in `frontend/` → 254/254, 0 cancelled;
`pnpm lint` 0; `pnpm typecheck` 0; `pnpm gate:size` pass; `pnpm gate:boundaries`
pass.

Limite ramase (neverificate aici):
- `pnpm verify` complet (gate:runtime, test backend, build:frontend,
  test:frontend:runtime, gate:package, gate:test) NU a fost rulat.
- Testele backend (cube/standalone) nu au fost rulate in aceasta sesiune.
- Validarea live in browser (F5 dupa raspuns pierdut, `corruptAfterCommit`,
  UI recovery 320/390px) ramane deschisa.
- Fara teste de randare pentru `OperationRecoveryNotice` / `use-authoring-recovery`
  (suita frontend nu are runner DOM; acoperirea e la nivel de lib/controller).

## Review final (2026-09-24, worker fix) — `/tmp/react-review.36zNVB/review.md`

Reparat in aceasta rulare (doar `frontend/`, fara commit, fara backend):

1. **MEDIUM test gap (`createDraftStep`)** — 10 teste noi in
   `invoice-draft-save-controller.test.ts` pe harness-ul deja existent:
   `hydrated:false` / journal indisponibil / journal corupt (niciun request),
   replay dupa F5 cu **body si cheie stocate** (`replayDraftCreation`, `key-1`,
   nu `createDraft`), alt fingerprint blocat, alta operatie in slot blocata,
   409 `idempotency_key_reused` si `draft_creation_result_deleted` → `state:'conflict'`,
   fara rotire de cheie si fara al doilea request, 400 definitiv → slot eliberat
   → `key-2`, `failRemove` → `RESOLVE_FAILED` in loc de „salvat". Red-green
   verificat pe ramura de conflict (mutant `markConflict`→`resolve`: 2 teste pica).
2. **`operation-replay.ts` effects care arunca dupa scrierea confirmata** —
   `onDraft`/`onIssued` sunt acum in `try` propriu; rezultatul ramane
   `{kind:'draft'|'issued', ...,  effectsError}`, cu identitatea documentului
   pastrata. Noua vedere pura `knownResultNotice` (`operation-recovery-view.ts`)
   transforma asta intr-un card care **numeste si linkuieste** documentul
   cunoscut si nu ofera replay (jurnalul e deja curat). **Corectie fata de
   versiunea anterioara a planului:** afirmatia ca „un save/emit normal nu poate
   crea un al doilea document" era adevarata doar pe ramura jurnalului
   (`recovery.blocked`). Pe ramura `useInvoiceIssuance.knownResult` era **falsa**:
   `canIssue=false` inchidea doar emiterea, dar `status.recoveryBlocked` nu
   includea acea sursa, deci „Salveaza draftul" ramanea activ si pe calea
   direct-issue putea crea un draft orfan pentru un document deja emis; in plus
   dismiss-ul era mort (fara `reset` pe mutatia de emitere) si `effectsError`
   aparea de doua ori (card + `mutationError`). Vezi „Fix M1" mai jos.
   4 teste de replay + 3 de vedere; niciun POST la retry de UI.
3. **`api-errors.ts`** — `failureMessages` acopera `idempotency_key_reused`,
   `draft_creation_result_deleted`, plus pre-existentele `invoice_already_issued`
   si `derived_draft_cannot_be_deleted` (acelasi corp 409 fara `message`).
   2 teste de parsare: niciun tag `DomainConflict` si niciun cod brut in text.
4. **Gol UX real pe ruta readonly** — traseu exact: `/drafts/{id}` editabil →
   „Emite" → record `issue-invoice`/`issue-draft` scris → raspuns 2xx corupt →
   `isLostResponse` → record ramane `pending` + `onOutcomeUnknown(draftId)`
   invalideaza `draftQueryKey` → refetch intoarce `status:'issued'` →
   `use-invoice-authoring-page.ts:78-86` intoarce `kind:'locked'` →
   `InvoiceAuthoringView` randa un card fara niciun element de recuperare, iar
   `OperationRecoveryNotice` exista doar in `InvoiceAuthoringSession` (ramura
   `ready`). Rezolvat prin `components/authoring/LockedDraftReadonly.tsx`:
   acelasi card de recuperare (replay same-key explicit / dismiss), montat doar
   pe ramura `locked`, deci fara a doua instanta de `useAuthoringRecovery` cand
   sesiunea e activa. **Fara** auto-rezolvare euristica pe buyer/payload.
   Nota: sumarul browserului confuza calea directa cu cea din draft — sursa
   verificata este cea de mai sus (`issue-draft`, nu `issue-invoice` direct).
5. Finding #8 (`busy`/`aborted` inghitite) — `lib/draft-removal-feedback.ts`,
   pur si testat (5 teste): `busy` → `removalPending` true (nu tacere la al
   doilea click), `aborted` → fara eroare (sesiune incheiata, mesajul ar fi
   despre munca pe care n-o mai asteapta nimeni), `unconfirmed` → mesaj propriu.

### Fix M1 (guard unificat pentru rezultat cunoscut)

Sursa unica, pura si consumata de hook-ul de productie:
`lib/invoice-authoring-derived.ts` → `authoringRecoveryDerived` (jurnal +
`knownResult` de emitere → `notice`, `blocked`, `acknowledges`,
`suppressIssuanceError`) si `issuanceAllowed` (poarta butonului de emitere).

- `use-invoice-authoring-session.ts` consuma `authoringRecoveryDerived`:
  `status.recoveryBlocked` acopera acum **ambele** surse (save blocat), iar
  `feedback.recoveryNotice` vine din acelasi rezultat, cu precedenta jurnalului
  (intentia lui poate cere inca replay).
- `use-invoice-issuance.ts` expune `reset()` (`mutation.reset()`, patternul deja
  folosit in `useOperationReplay`) si isi calculeaza `canIssue` prin
  `issuanceAllowed`. `actions.dismissRecovery` rutam pe ramura afisata:
  `acknowledges==='issuance'` → `invoiceIssuance.reset`, altfel `recovery.dismiss`.
  Dismiss-ul ramane explicit; nu se deblocheaza nimic in fundal si nu se roteste
  nicio cheie.
- Eroarea obisnuita e suprimata cat timp cardul de rezultat cunoscut e cel
  randat (`suppressIssuanceError`), ca sa nu existe doua mesaje pentru acelasi
  eveniment. Cand precedenta o are jurnalul, eroarea de emitere ramane vizibila.
- Test: `lib/invoice-authoring-derived.test.ts` (6 teste) pe derivarea reala
  folosita de sesiune — `blocked` **si** `issuanceAllowed(...)===false` pentru
  acelasi `knownResult` (save + emitere inchise simultan), precedenta jurnalului,
  jurnal nehidratat fara notice, `effectsError` absent = fara blocare, dismiss ca
  singura cale de redeschidere. Red-green: mutanti pe `blocked`,
  `suppressIssuanceError`, `issuanceAllowed` si `acknowledges` → 1, respectiv 3
  teste pica; fisierul restaurat → 6/6 verde. Un test doar pe controller **nu**
  ar prinde lipsa acestui gating in hook si nu se pretinde asta.
- `useMutation.reset` verificat pe sursa instalata (cache Context7 `missing`
  pentru `/tanstack/query`, MCP indisponibil in acest agent):
  `@tanstack/query-core@5.102.8` `build/modern/mutationObserver.js:49-54` —
  `reset()` detaseaza mutatia curenta, reconstruieste rezultatul din
  `getDefaultState()` (`data: undefined`, `status: 'idle'`) si notifica
  observatorii (`useSyncExternalStore` → re-render), iar `bindMethods()` (l. 18)
  leaga `reset`, deci apelul e sigur si prin referinta. `knownResult`, derivat din
  `mutation.data`, redevine `undefined` — exact ce cere acknowledge-ul explicit.

### Fix cosmetic (`LockedDraftReadonly`)

Link-ul „Deschide registrul de facturi" era `.button` (inline) intr-un `<p>`:
`min-height`/`padding` nu ridica line-box-ul, deci cutia lui se suprapunea peste
paragraful de deasupra (observat la 320 si 390 px: paragraf bottom 382, link top
372 → textul „emis din nou" acoperit; `.playwright-mcp/t1451-s4-readonly-320.png`,
`...-390.png`). Fix cu primitivele existente: link-ul sta in `<div className="page-actions">`
(`display:flex; flex-wrap:wrap; gap:.6rem`, acelasi container folosit de
`Page.tsx` pentru link-uri-buton) — devine flex item, deci `min-height` se aplica
si nu mai iese din flux. Fara CSS nou, fara valori arbitrare.

### Limitari acceptate, non-blocante

- **#7 getter mutabil in render** (`unconfirmedIssue()`, `unconfirmedMessage()`):
  **NU** este stare abonata si nu se pretinde ca ar fi. Garantia exacta: valoarea
  e citita la fiecare render si se schimba numai in interiorul unei mutatii
  TanStack Query, al carei settle declanseaza intotdeauna un re-render al
  aceluiasi component; controller-ul traieste exact cat mount-ul (`useState`
  initializer), deci nu exista scriitor din afara acelui ciclu. Daca vreodata
  un alt hook scrie in controller fara mutatie, valoarea nu s-ar reflecta.
  Eliminarea duplicarii ar cere redesenarea semanticii de editare existente
  (jurnalul acopera create/issue, nu si scrierile incrementale pe draft
  cunoscut, care raman fara idempotenta de server) — in afara scopului acestui fix.
- **#9 clients/router/queryClient capturate in initializatorul `useState`**:
  risc acceptat pe baza arhitecturii de singleton + auth (`use-invoicing-clients.ts:30-35`
  memoizeaza pe `transport`, `use-auth-controller.ts:17-37` il construieste o
  singura data per `queryClient`/`router`). Nu se introduce o abstractie noua de
  transport pentru asta.
- **#11**: fisierul acesta de plan este document de proiect versionat si intra in
  commit-ul final; nu se adauga in `.gitignore`. Nu e bug ca e untracked inainte de commit.
- Split-ul optional al constantelor din `operation-recovery-port.ts` nu a fost
  facut: scope creep fara castig de comportament.
- Fara teste DOM/RTL: suita frontend nu are runner DOM. `LockedDraftReadonly` si
  `OperationRecoveryNotice` raman verificate la nivel de model pur
  (`knownResultNotice`, `recoveryNotice`) plus inspectie in browser.

### Stare verificare (NU „PASS" general)

Rulat dupa fix-ul M1: `node --test "frontend/src/**/*.test.ts"` → **304/304**,
0 fail; `pnpm lint` 0 erori; `pnpm typecheck` 0; `pnpm gate:size` pass;
`pnpm gate:boundaries` pass (622 module).

`pnpm verify` anterior fix-ului: **835/835 + 8/8**, 0 fail (log
`/tmp/t1451-verify-after-review.log`). Reluarea completa `pnpm verify` dupa
fix-ul M1 si cel cosmetic ramane in sarcina supervizorului.

Browser (pe build-ul de dinaintea acestui fix, scenarii critice) — **PASS**:
discriminarea endpointurilor (`POST /api/invoices` direct vs
`POST /api/drafts/{id}/issue`), raspuns pierdut + F5 → replay same-key → acelasi
id, contor +1 o singura data; draft-issue cu 2xx corupt → ruta `locked` →
recuperare din `LockedDraftReadonly` pe aceeasi ruta; create cu raspuns non-JSON
+ F5 → atomicitate (o singura linie scrisa, zero scrieri suplimentare); marker la
logout si dismiss-ul lui; 409 pe document sters → mesaj citibil.
Singurul defect gasit acolo a fost suprapunerea cosmetica de mai sus, acum
rezolvata; **DOM-ul layout-ului corectat nu e inca revalidat in browser** —
acesta e smoke-ul final de browser, plus reverificarea dismiss-ului pe ramura
`issuance` (fixture-ul rula build-ul vechi, fara restart in acest pas).
