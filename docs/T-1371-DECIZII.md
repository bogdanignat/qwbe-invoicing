# T-1371: completarea datelor firmelor (plugin `company-lookup`), deciziile

Pluginul completează datele unei firme din CUI (și, cu openapi.ro, sugerează firme după nume) în
fișa clientului, la cumpărătorul ocazional și în datele emitentului. Branch
`feat/T-1371-validare-firme`, câte un commit pe task: A (T-1884) cubul, B (T-1885) kernelul,
C (T-1886) Setări → Integrări, D (T-1887) formularele, E (T-1888) verificarea și documentația.
Planul (v2) a primit review de la Astra (hub review `invoicing-qwbe-T-1371-plan-review-astra`).

## Direcția (decisă de Bogdan, 2026-10-19)

- Plugin separat, `company-lookup`, pornit și oprit din `QWBE_PLUGINS`, ca `payments` și `efactura`.
- Doi furnizori, fiecare cu comutatorul lui în Setări → Integrări: **ANAF** și **openapi.ro**.
  Sunt exclusivi: pornirea unuia îl oprește pe celălalt, dar pot fi și amândoi opriți.
- Singura setare editabilă, pe lângă comutatoare, e **cheia openapi.ro**. URL-urile și pragurile
  sunt fixe în cod.
- Pragurile: CUI de minimum 4 cifre, cu cifra de control validă, și nume de minimum 6 litere.
- Nu avem o limită proprie de cereri. Când openapi.ro spune că s-a terminat cota, afișăm doar
  mesajul; cine are nevoie de mai multe cereri își ia abonament.

## Deciziile din plan

| # | Decizie | Motiv |
|---|---|---|
| 1 | `company-lookup` e un cub-copil al `invoicing`, `required: false`, cu baseline-ul lui (`company_lookup_settings`), după modelul `payments`. Migrarea rulează mereu. | Schema rămâne una singură, iar setările se păstrează la oprirea și repornirea pluginului (T-1876, decizia 7). |
| 2 | Setările se țin într-un singur rând pe organizație: `provider` (`none`/`anaf`/`openapi`) și cheia criptată. Un CHECK refuză `openapi` fără cheie. | Exclusivitatea furnizorilor vine din model: e o singură coloană, deci nu pot fi două comutatoare pornite. |
| 3 | Cubul e pur: regulile setărilor, pragurile și maparea răspunsurilor în propuneri. HTTP-ul, cache-ul și criptarea cheii stau în `kernel/company-lookup/`. | Aceeași separare ca la e-Factura (T-1876, decizia 15). Cubul nu atinge rețeaua și nici `node:crypto`. |
| 4 | Rezultatul e o **propunere**: cardul „Am găsit: …” are butonul **Completează**. Fără click nu se suprascrie nimic. Firma radiată sau inactivă primește un avertisment. | Utilizatorul decide ce intră în formular. Datele furnizorului pot fi vechi sau greșite. |
| 5 | Clientul primește TVA-ul ca bifă sugerată, pe care o poate schimba. Regimul TVA al emitentului nu se schimbă niciodată din lookup, ci se afișează doar ca informație. Clientul nu are Nr. Reg. Com. în model, deci nu i se completează. | Regimul TVA al emitentului are istoricul și regulile lui (`docs/VAT_TREATMENT.md`). Câmpuri noi la client nu intră în acest task. |
| 6 | Adresa de la ANAF e structurată și se mapează direct. De la openapi.ro vine un singur rând de text: din el se iau doar județul și codul poștal, iar rândul se afișează ca referință. | Se propune doar ce e sigur. Parsarea unui text liber ar ghici localitatea și strada. |
| 7 | Rutele există doar cu pluginul pornit (altfel 404): `GET`/`PUT /settings/company-lookup` (`settings.manage`), `GET /company-lookup/availability`, `POST /company-lookup/lookup`, `POST /company-lookup/search`. | Lookup-ul și căutarea sunt `POST`, ca să treacă prin verificarea CSRF a BFF-ului. |
| 8 | Sub prag, cu CUI invalid sau fără furnizor pornit, nu pleacă nicio cerere externă: răspunsul e 400, respectiv 409. Pragurile se verifică și în browser, înainte de cerere. | Așa nu se consumă degeaba nici cota openapi.ro, nici limita ANAF. |
| 9 | Cheia openapi.ro e write-only. Se criptează cu AES-256-GCM, cu o cheie-master citită din fișierul `COMPANY_LOOKUP_KEY_FILE`. În răspunsuri apar doar `openapiKeyConfigured` și `openapiKeyLast4`. | Cheia e un secret al utilizatorului. Nu trebuie să apară în răspunsuri, loguri sau erori și nici în clar în DB. |
| 10 | Erorile furnizorului au codurile lor: cotă 429, „în coadă” 503 cu `retryAfterSeconds`, cheie refuzată 502 `auth_failed`, indisponibil 502. Nu se folosește niciodată 401. | Frontend-ul închide sesiunea la 401, iar o cheie openapi refuzată nu înseamnă o sesiune refuzată. |
| 11 | Cache-ul stă în memorie și se creează o singură dată pe proces: 24 h, maximum 500 de intrări (LRU). Cererile identice simultane se comasează. Activarea se verifică înainte de cache. | Același CUI cerut de mai multe ori nu mai pleacă extern. Un furnizor oprit nu răspunde nici din cache. |
| 12 | Setări → Integrări este o pagină nouă, `/settings/integrations`, cu navigarea „Emitent | Integrări”. E vizibilă doar cu pluginul pornit și cu `settings.manage`. Nu intră nicio librărie nouă. | Emitentul rămâne neatins la `/settings`. Primitivele noi (`ui/Switch`, `ui/Combobox`) urmează stilul celor existente. |

## Deciziile luate pe drum

| # | Decizie | Motiv |
|---|---|---|
| 13 | Lookup-ul și căutarea cer o permisiune nouă, `company-lookup:company.lookup`, acordată doar cât pluginul e pornit. Administrarea folosește `invoicing:settings.manage`, pe care hostul o transmite cubului. | Cine completează formulare nu administrează automat integrarea. Cubul nu-și scrie singur numele părintelui (T-1876, decizia 20). |
| 14 | Criptarea folosește un IV nou la fiecare scriere și organizația ca date asociate (AAD). Cifrul se stochează ca `v1.<iv>.<tag>.<cifru>`. | Un cifru copiat în rândul altei organizații nu se deschide. Versiunea permite schimbarea formatului mai târziu. |
| 15 | Fără `COMPANY_LOOKUP_KEY_FILE`, salvarea cheii openapi e refuzată (409 `company_lookup_key_storage_unavailable`), iar ANAF merge mai departe. Un fișier setat, dar ilizibil sau greșit, oprește pornirea. O cheie-master schimbată face cheia salvată ilizibilă: furnizorul apare oprit, iar logul o spune o singură dată. | Instalarea fără integrare cu plată rămâne validă. O configurare greșită e refuzată clar, nu ghicită. |
| 16 | Cheia de cache cuprinde organizația, furnizorul, **versiunea setărilor** (hash din furnizor și cifru), operația și interogarea normalizată, dar nu și cheia openapi. Se reține și „nu există”; eșecurile nu se rețin. | Orice schimbare de furnizor sau de cheie invalidează automat răspunsurile vechi, iar cheia nu ajunge în memoria cache-ului. |
| 17 | ANAF are o coadă pe proces, comună tuturor organizațiilor: o cerere pornește cel mult o dată pe secundă, iar peste 10 cereri în așteptare răspunsul e imediat `unavailable`. Un răspuns despre alt CUI decât cel cerut e tratat tot ca `unavailable`. | Limita ANAF e pe client, nu pe organizație. O coadă nelimitată ar transforma o rafală într-o așteptare fără sfârșit. |
| 18 | Transportul are timeout de 5 s, inclusiv pentru corp, refuză redirect-urile și corpurile de peste 256 KB și folosește o decodare strictă. Mesajele de eroare sunt fixe, în română; textul furnizorului nu se transmite mai departe. | Eroarea unui `fetch` eșuat poate cita headerele, deci și cheia (`x-api-key`). |
| 19 | La openapi.ro, CIF-ul se acceptă ca text sau ca număr. Sugestiile cu CUI invalid nu se afișează. | O sugestie se alege ca să se caute după CUI-ul ei, iar unul invalid ar fi refuzat oricum. |
| 20 | Maparea ANAF: codul auto (`SB`, `B`) devine cod ISO (`RO-SB`). Sectorul vine din localitatea `Sector N …`, iar orașul pentru București e „București”. Codul poștal din București cu 5 cifre primește un 0 în față. Firma e marcată radiată după `dataRadiere` sau după starea `RADIERE…`. | Așa arată datele reale ANAF. Ce nu se poate deduce sigur rămâne gol. |
| 21 | openapi.ro nu dă sectorul ca dată separată, ci doar în textul adresei (`… Sect 1`). Pentru București sectorul rămâne de ales de utilizator. | Aplicăm decizia 6: textul liber nu se parsează. |
| 22 | Ștergerea cheii cu openapi pornit trimite, în aceeași cerere, `provider: "none"` și `clearOpenapiKey`. UI-ul cere confirmare și spune că openapi.ro se oprește odată cu cheia. | Nu poate exista nicio stare în care comutatorul e pornit, dar cheia lipsește. |
| 23 | În browser, cererea pleacă după 600 ms de liniște (debounce), cu `retry: false`. Schimbarea tipului de persoană sau a clientului anulează căutarea în curs. Pragurile serverului, citite din `availability`, le pot doar ridica pe cele din browser. | Nu se face câte o cerere la fiecare tastă și nu apar răspunsuri întârziate pentru alt client. |
| 24 | Scrierile legate de sesiune (CSRF și epoca sesiunii) au acum un helper comun, `lib/session-write.ts`, folosit și de scrierile existente. | Setările noi aveau nevoie de același tipar ca registrele, plățile și seriile. Am preferat un singur loc în locul unei a cincea copii. |
| 25 | Gate-ul de schemă PG (`probes/pg-schema-gate.mjs`) numește explicit `company_lookup_settings` ca tabel apărut după captura SQLite. Rezultatul e 27 de tabele și 101 CHECK-uri. | Captura SQLite e istorică și nu se rescrie. Tabelul nou e declarat, nu tolerat tacit. |
| 26 | Testele HTTP pe combinațiile de pluginuri (`payments` × `efactura`) includ și `company-lookup`: pornit în două combinații, oprit în celelalte două. | Acoperă 404-ul, OpenAPI-ul și sesiunea fără o a treia dimensiune de combinații. |
| 27 | **Reparat la verificarea E (bug):** comutarea pe openapi cu cheia deja salvată (`PUT {provider: "openapi"}`) dădea 409 `persistence_conflict`. PostgreSQL verifică CHECK-urile pe rândul propus de `INSERT` înainte de `ON CONFLICT`, iar acolo cifrul era `NULL` la „păstrează cheia”. Acum cifrul păstrat se citește în rândul propus, sub lock-ul exclusiv al setărilor. Testul `company-lookup-api.test.ts` acoperă cazul. | Fluxul firesc din UI, adică salvez cheia și apoi pornesc openapi.ro, era imposibil. Testele inițiale treceau doar pentru că salvau cheia și furnizorul în aceeași cerere. |
| 28 | **Reparat la verificarea E (bug):** pentru un CUI valid, dar inexistent, ANAF răspunde **HTTP 404** cu corpul obișnuit `{found: [], notFound: [cui]}`. Adaptorul trata orice răspuns non-200 ca `unavailable`, deci 502. Acum 404 cu `notFound` înseamnă „firma nu există” (404 `ResourceNotFound`). Un 404 cu altă formă rămâne `unavailable`. Testul e în `anaf-client.test.ts`. | Este forma reală a serviciului, observată live pe 2026-10-19. Fixture-urile o presupuneau cu 200. |
| 29 | Fișierul `.local/openapi-ro-key` din checkout-ul principal nu l-am șters la E, deși planul o cerea. | E în checkout-ul lui Bogdan, în afara worktree-ului. Cheia e salvată doar în stack-ul de test, care a fost șters, deci decizia rămâne la Bogdan. |

## Verificarea finală (2026-10-19)

Verificarea a rulat pe un stack separat, construit din worktree: proiectul `qwbe-invoicing-t1371`,
imaginile `:t1371`, volumele `qwbe-invoicing-*-t1371` și secrete noi. Stack-ul n-a folosit nici
rețeaua `warden`, nici routerul traefik al stack-ului dev; frontend-ul a fost publicat doar pe
`127.0.0.1:3191`. Am lucrat ca un browser: login prin BFF, cookie și `x-csrf-token`, plus
chromium headless pentru UI. Un preload Node, montat doar în acest stack, a logat metoda, URL-ul,
statusul și forma JSON a fiecărui `fetch` ieșit (fără headere), ca să pot număra cererile
externe. După verificare, stack-ul și volumele lui au fost șterse. Datele clientului și ale
emitentului au fost inventate; CUI-urile sunt de firme publice.

- **Setări → Integrări** (HTTP și UI):
  - la pornire, furnizorul e `none`;
  - pornirea ANAF merge;
  - openapi.ro fără cheie dă 400, iar UI-ul spune „openapi.ro pornește doar cu o cheie salvată”;
  - după salvare, cheia apare doar ca `openapiKeyLast4`, iar în DOM nu există;
  - comutarea pe openapi.ro oprește ANAF și invers (aici era bugul de la decizia 27);
  - înlocuirea cheii merge;
  - ștergerea cheii cu openapi.ro pornit oprește furnizorul și afișează „Nicio cheie configurată”.
- **ANAF real:**
  - 13548146 dă CUBUS ARTS SRL, cu adresa structurată: Mun. Sibiu, Cal. Cisnădiei nr. 64,
    RO-SB, 550376, plus Nr. Reg. Com. și TVA;
  - 1590082 dă OMV PETROM SA, cu București, sector 1, Str. Coralilor nr. 22, 013329;
  - 12345674 dă BARS COMPANY S.R.L. (București, sector 3), marcată radiată;
  - 13548147, cu cifra de control greșită, dă 400 fără nicio cerere externă (la fel și `123`);
  - 999999878, valid dar inexistent, dă 404 după reparația de la decizia 28 (înainte dădea 502).
- **openapi.ro real, 4 cereri în total** (din cele maximum 8 permise):
  - lookup 13548146: forma reală e `{cif, denumire, numar_reg_com, adresa, judet, cod_postal,
    tva, radiata, stare, meta, …}`, pe care decodorul o acceptă;
  - căutarea „Cubus Arts”: forma reală e `{data: [{url, cif, judet, denumire}]}`, 2 sugestii;
  - cheie greșită: openapi.ro răspunde 403 cu `{error: {…}}`, noi dăm 502 `auth_failed`, iar
    sesiunea rămâne deschisă;
  - lookup 1590082 în ciclul pentru loguri;
  - formele reale corespund decodoarelor, deci n-a fost nevoie de nicio corectură.
- **Cache:**
  - al doilea lookup pe același CUI nu a mai plecat extern, la ANAF și la openapi.ro;
  - căutarea „cubus   ARTS” a folosit răspunsul pentru „Cubus Arts”;
  - verificarea din UI în modul openapi a mers integral din cache (0 cereri).
- **UI** (chromium headless):
  - cardul „Am găsit: …” apare, iar Completează umple câmpurile și bifa TVA;
  - sugestiile pe nume apar doar cu openapi.ro; cu ANAF câmpul nu e combobox și nu pleacă nicio
    căutare;
  - emitentul primește Nr. Reg. Com. și sectorul, iar regimul TVA rămâne neschimbat;
  - pentru CUI-ul inexistent apare „Nu am găsit firma.”.
- **`QWBE_PLUGINS=payments,efactura`:**
  - sesiunea are `plugins: ["payments", "efactura"]`;
  - toate cele 5 rute company-lookup dau 404;
  - în UI nu apare linkul „Integrări”, iar `/settings/integrations` spune că nu există integrări
    pornite;
  - formularele nu au card și nici sugestii;
  - din browser nu pleacă nicio cerere company-lookup, iar din backend nicio cerere externă;
  - la repornirea fără variabilă, setările (ANAF și cheia) erau încă acolo.
- **Cheia** nu apare nicăieri:
  - nici în răspunsurile BFF, nici în `docker compose logs` (toate serviciile);
  - nici în dump-ul tabelului, unde e doar `v1.…` criptat, nici în `docker inspect`.
- `scripts/verify-docker.sh verify`, rulat cu proiectul `qwbe-invoicing-verify-seanettle`, a ieșit
  verde: runtime, lint, typecheck, 1293 de teste, build-ul frontend-ului și 8 teste de runtime pe
  el, plus gate-urile de pachet, teste, mărime și granițe (747 de module, nicio încălcare).

### Ce n-a fost verificat live

- Cota terminată (429) și „în coadă” (202) la openapi.ro: nu se pot provoca fără să consumăm cota.
  Le acoperă testele cu transport fals.
- Răspunsul openapi.ro pentru un CUI inexistent: am păstrat bugetul de cereri. Îl acoperă tot
  testele (404 înseamnă firmă inexistentă).
- De știut: ANAF scrie localitatea așa cum e în registru, de exemplu „Mun. Sibiu”. Propunerea o
  copiază întocmai, iar utilizatorul o poate scurta înainte să salveze.
