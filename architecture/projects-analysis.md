# Analiza de arhitectura pentru personal-hub (T-1478)

Document de insotire pentru `architecture/contract.json`. Explica ce masoara raportul
de arhitectura generat din acest repository, cu ce comenzi a fost verificat, ce acopera
si — mai important — **ce nu acopera**. Nu propune si nu aplica nicio schimbare de cod
sau de reguli: toate regulile din contract existau deja in `dependency-cruiser.config.cjs`
si in `probes/`.

## 1. Cum e generat raportul

Hub-ul (`~/projects/personal-hub`) nu re-deriva graful acestui repository. Analizorul
`native-boundaries` ruleaza probe-ul propriu al proiectului si traduce protocolul lui JSON
(`schemaVersion 1`) in `architecture-report.v1`. Executia cere **consimtamantul explicit al
operatorului** prin `--allow-native`:

```bash
cd ~/projects/personal-hub
bun run architecture-report run --project=invoicing-qwbe \
  --path=/home/bogdan/projects/invoicing-qwbe --allow-native --json
```

### Model de incredere: doua porti independente

1. **Proiectul ofera proba** — o singura linie in `architecture/contract.json`, validata fara
   sa se execute nimic:

   ```json
   "native": { "command": "probes/boundary-report.mjs", "args": ["--json"] }
   ```

2. **Operatorul autorizeaza invocarea** — `--allow-native`, valabil doar pentru invocarea
   respectiva. Opt-in-ul din contract **nu e suficient**: un repository (sau un pull request
   in el) nu se poate autoriza singur si nu exista nicio variabila de mediu si niciun fisier
   de config care sa poata da aceasta autorizare.

Consecinte verificate:

- `run` fara flag se opreste **inainte sa porneasca orice proces**, cu exit 2 si mesajul
  `Analyzer native-boundaries runs the project's own probe as a child process; pass
  --allow-native to authorize this invocation (architecture/contract.json offers the probe,
  it cannot authorize running it)`. Asta include `--diff --fail-on-new`, care deci nu poate
  trece niciodata cazand pe raportul stocat.
- Jobul automat de context (`~/.claude/scripts/project-context.sh`, folosit in brief-urile
  agentilor) **nu paseaza flagul**, deci nu executa nimic din acest repository: tipareste
  liniile `Arhitectura` si `Raport` din ce e stocat si pentru delta spune
  `Delta vs origin/main: indisponibil (analizorul native-boundaries executa proba
  proiectului; ruleaza cu --allow-native pentru delta)`.
- Securitatea e mai puternica decat inainte prin **permisiune explicita de operator**, nu
  prin sandbox. Cu ambele porti executia e **marginita, nu izolata**: interpretor fix
  (acelasi `node`), `shell: false`, `cwd` explicit, doar argumentul cunoscut `--json`, mediu
  minimal (`PATH`, `HOME`, `TMPDIR`/`TMP`/`TEMP`, `LANG`, `LC_ALL`, `TZ`, `NO_COLOR`), deci
  niciun token, nicio cheie de API si niciun `NODE_OPTIONS` nu ajung la copil; `stderr`
  plafonat la 64 KiB si sanitizat la 2000 de caractere; stdout maxim 16 MiB. Proba ruleaza ca
  acelasi utilizator, cu acelasi acces la fisiere si la retea — asta nu e prevenit, e
  acceptat.
- **Grup de procese propriu.** Copilul e pornit `detached`, deci pe POSIX e liderul unui grup
  nou (`pgid === child.pid`), si la timeout, la stdout peste 16 MiB, la eroare de spawn si la
  `SIGINT`/`SIGTERM` in parinte se omoara **tot grupul** cu `SIGKILL`: copilul propriu al
  probei (`depcruise`) nu supravietuieste ca orfan. Limite cunoscute: un descendent care isi
  face sesiune proprie (`setsid`) scapa, iar pe Windows nu exista grupuri POSIX, deci acolo
  moare doar copilul direct.
- **Timeout-uri in doua etaje, nemodificate pe partea proiectului.** Hub-ul taie la 90000 ms
  (implicit si maxim), deliberat peste deadline-ul intern al probei pentru copilul
  `depcruise` (`DEFAULT_TIMEOUT_MS = 60_000` in `probes/boundary-report.mjs`), ca eroarea
  curata raportata de proba sa bata un kill extern. `native.timeoutMs` e optional
  (1000..90000) si **nu e declarat aici**; nu e nevoie de nicio schimbare de comanda,
  `native.args` ramane `["--json"]`.
- Comanda e validata inainte de orice executie: cale relativa, fara segmente `.` sau `..`,
  fisier regular `.mjs`/`.js`/`.cjs`, fara symlink, `realpath` inauntrul proiectului — in
  `run` si in `context` la fel.
- Probe-ul insusi e read-only: scrie un singur config generat intr-un director temporar din
  OS si il sterge; nu citeste `.env`, nu citeste baza de date, nu ruleaza cod de aplicatie si
  nu are `--apply`. Rapoartele hub-ului se citesc; nimic nu se scrie in acest repository.
- Sursa: `probes/boundary-report.mjs` (`--help`, sectiunile Scope si Side effects),
  personal-hub `scripts/architecture-report/analyzers/native-boundaries.mjs`
  (`assertOperatorApproval`), `lib.mjs` (`assertAnalyzerApproval`),
  `analyzers/native/{contract,probe,run-process}.mjs` si `architecture-report --help`,
  sectiunea `native-boundaries: trust`.

## 2. Scope: ce e cruise-uit

Probe-ul reutilizeaza `boundaryGateInputs` din `probes/boundary-gate-lib.mjs`, exact functia
pe care o foloseste `pnpm gate:boundaries`. Deci raportul nu poate descrie alt graf decat cel
validat de gate.

- **Patru root-uri**, in aceasta ordine: `cube`, `standalone`, `web/src`, `frontend/src`
  (root-urile de cub vin din `qwbe.config.json` → `cubeRoots`).
- **Fisierele de test sunt incluse** (`.test.ts` / `.test.mjs` fac parte din graf), fara
  `tsconfig`, cu `tsPreCompilationDeps: true`.
- `doNotFollow`: `node_modules`, `probes/fixtures`, `frontend/.next` — muchiile directe spre
  ele ramane in graf, dar nu sunt traversate.
- **Set de reguli**: 23 de reguli statice din `dependency-cruiser.config.cjs` plus 102 reguli
  generate dinamic din unitatile de cub descoperite (`probes/boundary-rules.mjs`), total 125.
- **11 unitati de cub** descoperite prin `qwbe-package.json`: `cube/efactura`,
  `cube/invoicing` + 8 copii (`catalog`, `corrections`, `customers`, `documents`, `drafts`,
  `issuance`, `issuer`, `parties`), `cube/payments`.
- **14 arii** = cele 11 unitati de cub plus `standalone`, `web/src`, `frontend/src`. Un fisier
  e atribuit ariei cu cel mai lung prefix de folder, deci un cub copil isi detine fisierele.
  Un fisier local care n-ar cadea sub nicio arie ar fi pus in bucket-ul primului segment de
  cale, cu grupul `in-afara-ariilor`; in masuratoarea curenta nu exista niciunul.
- **Grupurile din raport vin din arii, nu din contract.** Analizorul nu citeste
  `contract.moduleGroups`; `report.modules[].group` e `areas[].group` al probe-ului
  (`cube/invoicing`, `cube/payments`, `cube/efactura`, `standalone`, `web`, `frontend`), deci
  se muta singur cu unitatile de cub. `moduleGroups` ramane in contract nominal, obligatoriu
  pentru `architecture-report.v1` si pentru vederea generica de contract.

## 3. Metrici masurate (1 octombrie 2026)

Branch `chore/T-1478-projects-analysis`, commit `0c85e894`, arbore murdar (`dirty=true`).

| Metrica | Valoare |
|---|---:|
| `totals.files` (fisiere locale ale proiectului) | 718 |
| `totals.imports` (importuri intre doua fisiere locale) | 2515 |
| `totals.cruisedFiles` (contorul brut al gate-ului) | 753 |
| `totals.cruisedImports` (contorul brut al gate-ului) | 3362 |
| noduri `node_modules` din graful brut | 18 |
| noduri core `node:` din graful brut | 17 |
| `totals.errors` / `warnings` / `cycles` / `unresolved` | 0 / 0 / 0 / 0 |
| reguli in contract | 25 |
| straturi in contract | 14 |
| decizii in contract | 11 |
| arii (`report.modules`) | 14 |
| muchii intre arii (`report.edges`) | 34 |
| muchii intre straturi (`report.layerEdges`) | 34 |
| `report_hash` | `e8ffae0c3f52bd4263f08f3fbcfd0c792219708ddb3ad94190556970665f0d8e` |
| `payload_bytes` | 32632 |
| durata rulare CLI | ~1,06 s (probe singur ~0,98 s, `pnpm gate:boundaries` ~1,3 s) |

### Doua masuratori, doua semantici (corectat)

`totals.files` / `totals.imports` inseamna acum **acelasi lucru ca pentru `react-modules` si
ca in UI**: fisierele proprii cruise-uite ale proiectului (718) si inregistrarile de import
**intre doua fisiere locale** (2515). Suma `report.modules[].files` e tot 718 si suma
`layerEdges[].count` e exact 2515.

Contoarele brute ale probe-ului stau alaturi, ca `totals.cruisedFiles` /
`totals.cruisedImports` (753 / 3362): ele numara si nodurile `node_modules` (18) si cele core
`node:` (17) si **fiecare import extern**, deci sunt exact cifrele pe care le tipareste gate-ul
(`✔ no dependency violations found (753 modules, 3362 dependencies cruised)`). Asa raman in
raport, fara sa redefineasca `files`/`imports`.

**753 nu sunt 753 de fisiere sursa; nu poti numi toate cele 753.** 35 dintre noduri sunt
externe (`node_modules`) sau module core. Numarul de fisiere ale proiectului e 718. Ambele
masuratori sunt dinamice si de aceea **nu intra in `report.provenance`**: un import adaugat nu
trebuie sa faca incomparabil fiecare baseline stocat.

**Raportul anterior e obsolet.** `report_hash = 47721dd5…aadaf1` a fost generat cu semantica
veche a `totals` si nu mai poate fi reprodus. Hash-ul valabil, generat cu contractul final din
acest commit, e `e8ffae0c…0d8e`. Regenerarea e singura cale: nu exista conversie intre cele
doua forme, iar `report.contract` intra in hash, deci orice editare a contractului il schimba
(masurat: `328a6f8a…f14b6` inainte de ultima editare a deciziilor, `e8ffae0c…0d8e` dupa).

Distributia celor 718 fisiere locale: `cube` 133, `standalone` 136, `web/src` 148,
`frontend/src` 301.

### Fisiere per strat

`cube` 133, `standalone` 136, `web/src`: `web-lib` 73, `web-components` 36, `web-hooks` 23,
`web-views` 13, `web-shell` 3. `frontend/src`: `frontend-lib` 164, `frontend-components` 51,
`frontend-hooks` 44, `frontend-app` 20, `frontend-views` 13, `frontend-server` 8,
`frontend-shell` 1. Suma = 718, deci **niciun fisier local nu cade in afara straturilor
declarate** (`layerEdges` nu are nicio muchie `other`).

## 4. Provenance si stabilitate

`report.provenance` tine partea stabila a payload-ului probe-ului si niciodata graful brut
(~1,3 MB) sau `cruise.summary.optionsUsed.rulesFile`, care e o cale temporara per rulare.
Nu exista nicio data in provenance, deci un repository neschimbat se amprenteaza identic.
Contoarele (`files`, `imports`, `cruisedFiles`, `cruisedImports`) sunt masuratori dinamice si
sunt **in afara** provenance-ului, intentionat.

Cele 6 surse amprentate (sha256, sortate pe cale):

| Cale | sha256 |
|---|---|
| `dependency-cruiser.config.cjs` | `00291918502671ecfd11907e9038f283160827a57ce13b1abebc48b629ea32f1` |
| `probes/boundary-gate-lib.mjs` | `bbbc139b3fd52c8fd36bd0535b2d0d8e2e94d17e80cb95f61fb75c1b61b73dde` |
| `probes/boundary-report.mjs` | `4f08c813e3b14c65ab5c6dfd5a7d13ef5a9eb03c6c8ecc24138f49caa889b1d2` |
| `probes/boundary-rules.mjs` | `d710751419ba519c79acf24d2203a7ff97cef6e509af8467199589579c159058` |
| `probes/source-tree.mjs` | `3f15786a24f6b5d29aaba16cdb67fc683418e377ced663cceb57e17c5a30b1dd` |
| `qwbe.config.json` | `71362763dfde3945aea3433a2e3c7bbac1a2eacd381e77d63c0681d92e6b1c32` |

Plus `generatedRuleCount: 102`, root-urile cruise-uite, `mappingVersion: 1` si
`tool: dependency-cruiser 18.0.0`.

Doua rulari dry-run consecutive (a doua fara `--out`) au dat acelasi `report_hash`
(`328a6f8a…f14b6`, contractul de dinainte de ultima editare), deci hash-ul semantic e stabil
la rulari repetate pe acelasi input, iar probe-ul rulat separat a dat provenance identic.
Raportul final al acestui commit are `report_hash = e8ffae0c3f52bd4263f08f3fbcfd0c792219708ddb3ad94190556970665f0d8e`. Cele 6 hash-uri de sursa sunt
neschimbate fata de masuratoarea precedenta: s-a schimbat doar semantica `totals` din
analizorul hub-ului, nu codul acestui repository. Cand provenance difera de baseline-ul
stocat, `run --diff` raporteaza `baseline=incomparable` si `--fail-on-new` iese cu 2 in loc sa
pretinda ca nu sunt incalcari noi.

**Nu exista niciun baseline curat stocat.** `run --diff` raporteaza
`baseline=unavailable reason="no clean report stored for 24580b87f8e1 or an ancestor"` si
listeaza incalcarile din fisierele schimbate (`changed_files=185`, `new=0`). Motivul e ca
singurele snapshot-uri posibile acum sunt pe arbore murdar (`dirty=true`), iar `--apply`
sare peste raportul murdar si il accepta doar cu `--allow-dirty` — exact asa a fost stocat
raportul final (sectiunea 13). Un raport stocat pe arbore
murdar **nu** devine baseline curat; `--apply` nu creeaza un baseline curat atata timp cat
arborele e murdar.

## 5. Maparea stabila a regulilor

102 din 125 de reguli ale probe-ului sunt generate per pereche de unitati de cub, deci numele
lor se schimba la fiecare cub adaugat sau redenumit. Doua familii colapseaza in id-uri stabile:

| Nume nativ | Id in contract | Reguli in setul curent |
|---|---|---:|
| `no-cube-import-<sursa>-to-<tinta>` | `cube-izolare` | 38 |
| `cube-tree-<sursa>-to-<tinta>-only-through-index` | `cube-prin-index` | 64 |

Celelalte 23 isi pastreaza numele nativ, neschimbat. Toate cele 25 au `severity: "error"`,
exact ca in `dependency-cruiser.config.cjs` si in generatoarele din `probes/boundary-rules.mjs`.
O regula a probe-ului care s-ar mapa pe un id nedeclarat in contract, o regula din contract pe
care probe-ul nu a produs-o, sau o severitate care nu se potriveste, opresc rularea cu motivul
respectiv — nimic nu e aruncat silentios. Verificat: 125/125 nume mapate, 0 erori de mapare.
Setul de reguli e verificat **dupa** singura invocare a probe-ului; probe-ul nu e rulat
niciodata doar ca sa valideze contractul. Cele doua id-uri de familie sunt agregate si pot
legitim sa n-aiba niciun membru (un proiect cu o singura unitate de cub nu genereaza nicio
pereche), deci a le declara cu zero reguli generate e valid si ar numara 0.

## 6. Limite de acoperire

Acestea nu sunt defecte de configurare; sunt limitele reale ale raportului.

1. **`signals.*` e mereu gol — asta inseamna neimplementat, nu „UI curat".** Toate semnalele
   din `architecture-report.v1` sunt euristici React/Next (marime de componenta, hooks, fetch
   in componente) si analizorul `native-boundaries` nu presupune nimic despre framework.
   Pagina va arata 0 componente mari si 0 semnale de logica in componente pentru ca nu le
   masoara nimeni, nu pentru ca nu exista. Marimea fisierelor se vede din `pnpm gate:size`
   (6000 caractere de cod per fisier, 40000 si 15 fisiere per unitate de cub).
2. **`limits.componentMaxLines = 200` si `moduleGroups` sunt doar compatibilitate de
   schema.** Analizorul nu le citeste: limitele reale stau in `qwbe.config.json`, iar
   grupurile din raport vin din ariile probe-ului (`areas[].group`). Singura limita folosita
   efectiv e `maxViolationsDetailed = 200`.
3. **Gruparea din UI colapseaza sub-cuburile in unele liste.** Harta de module foloseste
   `report.modules[].group` si arata corect benzile `cube/invoicing`, `cube/payments`,
   `cube/efactura`, `standalone`, `web`, `frontend` (grupuri venite din `areas[].group`, nu
   din `contract.moduleGroups`). Dar lista de incalcari grupate pe regula
   atribuie fiecare incalcare prin `moduleOfPath`, care ia **primul segment de cale**
   (personal-hub `src/modules/Projects/lib/architectureView.ts`). Pentru acest repository asta
   inseamna ca toate cele 11 unitati de cub se agrega intr-o singura bucata `cube`, si tot
   `frontend/src` intr-una `frontend`. Cand apar incalcari, atribuirea pe cub se citeste din
   `violations[].from`, nu din acea lista. In plus `BAND_LABELS` din UI nu are etichete pentru
   grupurile acestui proiect (`cube/invoicing`, `standalone`, `web`, `frontend`), deci benzile
   se afiseaza cu id-ul grupului.
4. **Raportul nu e un gate.** `probes/boundary-report.mjs` raporteaza numere brute si nu spune
   niciodata daca gate-ul trece. Verdictul ramane `pnpm gate:boundaries` (si `pnpm verify`).
5. **Granularitatea straturilor pentru backend e deliberat grosiera.** `cube` si `standalone`
   sunt cate un singur strat, pentru ca regulile statice nu impun stratificare intre
   `domain/`, `application/` si `contracts/` sau intre `standalone/api`, `auth`, `storage` etc.
   Granita interna a cuburilor e exprimata prin arii plus `cube-izolare` si `cube-prin-index`,
   nu prin `layerEdges`. De aceea `cube -> cube` are 506 muchii si `standalone -> standalone`
   334 (din cele 2515 muchii intre straturi).

## 7. Observatii din graful masurat (nereparate, intentionat)

- **`standalone -> web/src`: 10 muchii.** Toate pleaca din fisiere `.test.ts` ale gazdei
  (`standalone/parity/fiscal-party-parity.test.ts`, `issuer-details-parity.test.ts`,
  `standalone/http/vat-treatment-http.test.ts`, `product-vat-preference-http.test.ts`,
  `standalone/efactura/efactura-issuance.test.ts`) spre `web/src/lib/*`. E exact rolul declarat
  al lui `standalone/parity/` — „tests that hold host, UI and cube rules in agreement"
  (README, Repository layout) — si nicio regula statica nu interzice `standalone -> web`.
  Consecinta de notat: dupa cutover-ul Next, aceste teste de paritate vor trebui re-ancorate
  pe `frontend/src/lib`, altfel verifica paritatea cu un UI scos din uz.
- **`web/src -> standalone`: 1 muchie**, `web/src/App.tsx -> standalone/http/ui-routes.ts`,
  exact exceptia pe care o descriu `web-does-not-import-backend-or-tooling`,
  `web-ui-routes-only-from-app` si `ui-routes-is-a-browser-leaf`.
- **`frontend-app -> frontend-server`: 5 muchii**, adica route handler-ele; nicio pagina si
  niciun layout nu importa `lib/server` (`frontend-app-does-not-import-server` = 0 incalcari).
- **`frontend-shell -> frontend-lib`: 1 muchie**, `frontend/src/proxy.ts`, care da doar
  security headers si nu e guard de autentificare.
- **Zero muchii `cube -> standalone`, `cube -> frontend`, `standalone -> frontend`,
  `web -> frontend`, `frontend -> web`.** Cele doua UI-uri sunt complet independente.
- `standalone` intra in cub pe 9 arii (`cube/invoicing` 55 de muchii, `cube/invoicing/documents`
  18, `cube/payments` 10, `cube/efactura` 9, `issuer` 8, `catalog` 7, `customers` 6,
  `corrections` 3, `issuance` 3); `cube/invoicing/drafts` si `cube/invoicing/parties` nu sunt
  atinse direct de gazda.

## 8. Migrarea Next (T-1400) nu e terminata

Repository-ul are **doua UI-uri care coexista** si contractul reflecta asta cu straturi
separate pentru fiecare:

- `web/` — UI-ul Vite/React existent, inca operational si servit de backend; 148 de fisiere.
- `frontend/` — pachetul Next 16 din workspace-ul pnpm, `appRoot = frontend/src/app`;
  301 de fisiere, deja cel mai mare arbore din repository.

Stare (sursa: `docs/NEXT_PREVIEW.md`): fazele una–cinci au migrat unlock/sesiune, registrul de
facturi, documentele, autoringul si draft-urile, proformele, catalogul de produse, registrul de
clienti si setarile de emitent. **Ecranul de plati nu e migrat.** Nu s-a facut cutover: nu s-a
schimbat traficul, nu s-a scos `web/`, imaginile `qwbe-invoicing:t1400-preview` si
`qwbe-invoicing-frontend:t1400-preview` sunt locale si nepublicate. Pasii ramasi declarati:
portarea ecranelor lipsa, redirect UI `/products` → `/catalog`, scoaterea servirii Vite din
backend, apoi rutarea Caddy/Traefik si doua digest-uri de imagine coordonate.

**Gap de documentatie:** `README.md` si `FOUNDATION.md` nu descriu `frontend/` ca aplicatie —
sectiunea „Repository layout" din README si sectiunea 14 din FOUNDATION se opresc la `web/`,
iar lista de stack spune „React 19, Vite, pnpm" fara Next. Singurul document care descrie
pachetul Next e `docs/NEXT_PREVIEW.md`. De aceea `contract.json` are `stack: "nodejs+nextjs"`:
descrie amestecul real (backend Node/Effect + Next 16 + SPA Vite legacy). Enumerarea
`project.stack` din registrul Strapi nu are o valoare combinata (doar `nodejs`, `nextjs`,
`react`, …), deci metadata din registru ramane fie `nodejs`, fie se trece pe `nextjs` dupa
cutover; e o decizie de registru, nu de contract. `contract.stack` nu ajunge oricum in raport:
`report.contract` tine doar `layers`, `rules`, `limits` si `decisions`.

## 9. Autentificare si UI: ce nu se vede in raport

Granitele statice nu spun nimic despre autentificare; ea e verificata de teste si de review,
nu de acest raport. Pe scurt, din `docs/NEXT_PREVIEW.md` (sectiunea Ownership and request flow):
backend-ul detine autentificarea si stocarea sesiunii; token-ul se introduce doar in formularul
de unlock si nu e pastrat in browser storage, in QueryClient, in variabile de mediu ale
frontendului sau in cookie de bearer; cookie-ul `qwbe_session` e opac, `HttpOnly`,
`SameSite=Strict`, `Path=/api` si intentionat indisponibil la cererile de pagina; mutatiile cer
Origin configurat exact si CSRF; throttle-ul de login e al backendului si e cheiat pe peer-ul de
socket, deci toate browserele din spatele preview-ului partajeaza acelasi bucket — acceptat
pentru preview-ul pe loopback, dar un cutover multi-user cere un design explicit de ingress de
incredere, nu incredere arbitrara in `X-Forwarded-For`.

Ce poate confirma raportul e doar partea de granita: `frontend-browser-does-not-import-server`
si `frontend-app-does-not-import-server` au 0 incalcari, deci codul de browser nu ajunge la
`frontend/src/lib/server`, iar `frontend-browser-does-not-import-node` tine modulele core `node:`
in afara arborelui de browser.

## 10. Versiuni: manifest vs instalat

Verificat direct in `node_modules` (1 octombrie 2026). **Toate se potrivesc exact cu
manifestele**; nicio deriva.

| Pachet | Manifest | Instalat |
|---|---|---|
| `dependency-cruiser` (root, devDep) | 18.0.0 | 18.0.0 |
| `typescript` (root / frontend) | 6.0.3 | 6.0.3 |
| `eslint` (root) | 10.0.1 | 10.0.1 |
| `vite` (root) | 8.2.2 | 8.2.2 |
| `react` / `react-dom` | 19.2.8 | 19.2.8 |
| `tailwindcss` | 4.3.3 | 4.3.3 |
| `@tanstack/react-query` | 5.102.8 | 5.102.8 |
| `effect` | 3.21.2 | 3.21.2 |
| `@effect/platform` | 0.96.1 | 0.96.1 |
| `@effect/platform-node` | 0.107.0 | 0.107.0 |
| `pdf-lib` | 1.17.1 | 1.17.1 |
| `sharp` | 0.35.4 | 0.35.4 |
| `next` (frontend) | 16.3.5 | 16.3.5 |
| `server-only` (frontend) | 0.0.1 | 0.0.1 |
| Node | `engines` + `.node-version` 24.19.0 | v24.19.0 |
| pnpm | `packageManager` 11.22.0 | 11.22.0 |

`report.tool.version` = 18.0.0 vine din `node_modules/dependency-cruiser/package.json`, adica
versiunea instalata, nu una presupusa de hub. Nota: documentatia de API a dependency-cruiser
din cache-ul Context7 e de la tag-ul `v18.4.0`, deci mai noua decat 18.0.0 instalat; probe-ul
foloseste oricum binarul CLI (`node_modules/.bin/depcruise --output-type json`), nu API-ul
programatic.

## 11. Runtime local, asa cum e acum

Masurat, nu presupus (1 octombrie 2026):

- **Aplicatia nu ruleaza.** Niciun container `qwbe-invoicing` pornit; ce exista sunt containere
  iesite din preview-ul T-1400 (`qwbe-invoicing-preview-frontend-1` Exited 143,
  `…-backend-fixture-1` si `…-migrate-fixture-1` Exited 0, acum 5 zile) si
  `qwbe-postgres-1` Exited 0. `docker compose ps` pentru `compose.yaml` nu returneaza nimic.
- **Niciun listener local pe 3000.** Singurul port relevant ascultat pe gazda e `0.0.0.0:443`,
  al lui `traefik` (container `traefik`, Up 26h, `0.0.0.0:80->80`, `0.0.0.0:443->443`).
- **Configurat, dar nepornit:** serviciul `app` din `compose.yaml` expune `3000` doar in reteaua
  `warden` (`expose: "3000"`, fara publish pe gazda) si are label-urile Traefik
  `Host(\`${APP_DOMAIN:-invoice.test}\`)`, entrypoint `https`, `tls: true`,
  `loadbalancer.server.port: 3000`. Deci ruta publica intentionata e
  `https://invoice.test` → Traefik (warden, 443) → container `app:3000`.
  `architecture-report context` raporteaza exact asta: `app - (nepornit) -> traefik
  https://invoice.test`.
- `.env` din repository are o singura cheie, `IMAGE_TAG`. **Valorile din `.env` nu au fost
  citite si nu apar nicaieri in acest document sau in contract.**
- **Nimic de aici nu e o afirmatie despre productie.** `compose.yaml` ruleaza cu
  `NODE_ENV: development`; bundle-ul de productie e `compose.prod.yaml`, iar fixtura HTTP din
  preview-ul Next e explicit marcata ca nefolosibila ca deployment de productie.

## 12. Verificari rulate

| Comanda | Rezultat |
|---|---|
| `bun run architecture-report run --project=invoicing-qwbe --path=… --allow-native --out=/tmp/T1478-invoice-report.json --json` | exit 0; `files=718 imports=2515 cruisedFiles=753 cruisedImports=3362 errors=0 warnings=0 cycles=0 unresolved=0 truncated=0`; `report_hash=e8ffae0c…0d8e`; `payload_bytes=32632`; log in `/tmp/T1478-invoice-report-run.log` |
| a doua rulare dry-run, fara `--out` (contractul de dinainte de ultima editare) | acelasi `report_hash=328a6f8a…f14b6` (hash semantic stabil pe acelasi input) |
| acelasi `run` **fara** `--allow-native` | exit 2, `status:"failed"`, nimic executat: `Analyzer native-boundaries runs the project's own probe as a child process; pass --allow-native to authorize this invocation` |
| `bun run architecture-report validate /tmp/T1478-invoice-report.json` | `valid: /tmp/T1478-invoice-report.json`, exit 0 (rulat si pe artefactul final) |
| `node probes/boundary-report.mjs --json` (proaspat) | `totalCruised 753`, `totalDependenciesCruised 3362`, 0 incalcari, 125 de reguli (102 generate), 14 arii, 4 root-uri, depcruise 18.0.0; provenance identic |
| `pnpm gate:boundaries` | exit 0, `✔ no dependency violations found (753 modules, 3362 dependencies cruised)` |
| `bun run architecture-report run … --allow-native --diff` | exit 0; `base=origin/main merge_base=24580b87f8e1… baseline=unavailable changed_files=185 new=0 resolved=0`; motiv: `no clean report stored for 24580b87f8e1 or an ancestor` |
| `bun run architecture-report context --project=invoicing-qwbe --path=…` (fara flag) | exit 0; `Arhitectura: … (14 straturi, 25 reguli, limite: componentMaxLines=200, 0 decizii deschise)`, `Raport: fara raport` (rulare de dinainte de `--apply`), `Delta vs origin/main: indisponibil (analizorul native-boundaries executa proba proiectului; ruleaza cu --allow-native pentru delta)`, runtime `app - (nepornit) -> traefik https://invoice.test` |
| acelasi `context` cu `--allow-native` | exit 0; delta se calculeaza: `baseline indisponibil (niciun raport pentru 24580b8 sau un stramos); 0 incalcari in 185 fisiere schimbate` |

Nerulate: `pnpm verify` (integral), `pnpm build:frontend`, orice migrare sau operatie de baza
de date, orice start/restart de container, orice deployment. Rulari din tabel si din sectiunile
1–11 care spun `fara raport` / `baseline=unavailable` sunt dry-run-uri istorice, pastrate ca
istoric; statusul final e in sectiunea 13.

## 13. Persistenta finala si verificari (1 octombrie 2026)

`--apply` **a fost rulat** pe hub (`--allow-dirty`, arbore murdar), nu doar dry-run:

| Artefact | docId | hash |
|---|---|---|
| raport de arhitectura | `rw2io2oku3cb3xs7h7p4gi7i` | semantic `e8ffae0c3f52bd4263f08f3fbcfd0c792219708ddb3ad94190556970665f0d8e` |
| runtime | `dkebhm3pkz73fj1bwk8w4bui` | `a6818d03281ecb585eb72054e86a2f073dd38a33a1d3b4eb1616c3379f133059` |

- Re-`--apply` pe ambele: **skipped, same hash** (idempotent).
- Readback complet prin MCP: verificat, inclusiv cele 6 hash-uri de provenance din sectiunea 4.
- Runtime stocat descrie `app` + `migrate` ca **absente, doar configurate**; nu s-a pornit
  nimic, nu s-a facut deployment si nu s-a atins baza de date.
- **Nu exista baseline curat**: snapshot-ul stocat e pe arbore murdar (sectiunea 4). Niciun
  commit, niciun push.
- `architecture/contract.json` si `probes/boundary-report.mjs` nu se editeaza dupa aceasta
  masuratoare — orice editare schimba `report_hash`.

Verificari finale rulate:

| Verificare | Rezultat |
|---|---|
| teste hub | 184/184 pass, log `/tmp/T1478-hub-tests-final.log` |
| teste invoicing (targetate) | 61/61 pass, log `/tmp/T1478-invoice-tests-final.log` |
| lint, ambele repo-uri | pass |
| `pnpm gate:boundaries` | exit 0, 0 incalcari |
| `pnpm verify` integral | **nerulat** |
| review-uri | ambele PASS, reziduale low → follow-up T-1479 |
| browser `https://hub.local/projects/invoicing-qwbe` | redirect la login; **continutul paginii nu e verificat vizual** |
