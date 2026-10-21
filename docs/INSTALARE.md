# Ghid de instalare și configurare

Pentru cine administrează serverul: de la un server gol la prima factură emisă și,
opțional, la conectarea cu ANAF e-Factura. Detaliile complete (toate variabilele, API-ul,
modelul de securitate, CLI-ul) sunt în [`README.md`](../README.md).

## 1. Ce instalezi

O aplicație de facturare pentru România, găzduită de tine: facturi, proforme (document
nefiscal), storno în loc de editare, plăți, PDF și XML e-Factura (UBL / CIUS-RO). O
instalare servește o singură firmă, în RON. Rulează dintr-o **singură imagine Docker**
(UI-ul și API-ul pe aceeași origine) plus **PostgreSQL 16**. Serviciile din
`compose.prod.yaml`: `db`, `migrate` (aplică schema la fiecare pornire, înainte de
aplicație), `app` și, opțional, `caddy`.

Plugin-uri opționale, toate pornite implicit (`QWBE_PLUGINS`): `payments` (plățile),
`efactura` (XML-ul și, cu înregistrarea ta la ANAF, trimiterea în SPV) și `company-lookup`
(datele unei firme după CUI, de la ANAF sau openapi.ro).

## 2. Cerințe

- Server Linux `amd64` sau `arm64`; câteva sute de MB de disc ajung pentru ani de facturi.
- Docker Engine cu Docker Compose v2.
- Un nume DNS spre server (ex. `facturi.exemplu.ro`) și HTTPS printr-un reverse proxy:
  Caddy-ul inclus (profilul `proxy`, ocupă porturile 80 și 443 și obține singur
  certificatul) sau proxy-ul tău (nginx, Caddy, Traefik), care ajunge la aplicație pe
  `127.0.0.1`.
- HTTPS de ieșire, doar pentru ce folosești: căutarea firmelor la `webservicesp.anaf.ro`
  sau `api.openapi.ro`; e-Factura la `logincert.anaf.ro` (OAuth), `api.anaf.ro` (SPV) și
  `webservicesp.anaf.ro` (validare).

Detalii: [Requirements](../README.md#requirements).

## 3. Instalare

Comenzile rulează din directorul repository-ului.

1. Clonează codul:
   ```bash
   git clone https://github.com/bogdanignat/qwbe-invoicing.git
   cd qwbe-invoicing
   cp .env.example .env
   ```
2. Completează în `.env` (fiecare cheie din fișier spune ce face și dacă e obligatorie):
   - `PUBLIC_ORIGIN=https://facturi.exemplu.ro`: exact adresa scrisă de utilizatori, fără
     cale și fără `/` la final;
   - `ORGANIZATION_ID`: id-ul intern al firmei (litere mici, cifre, cratimă, ex.
     `ro12345678`), ales o dată, înainte de primul start, și neschimbat apoi;
   - `QWBE_IMAGE=qwbe-invoicing` și `IMAGE_TAG=local` rămân așa pentru imaginea de la pasul 5.
3. Alege intrarea HTTPS și scrie-o tot în `.env`, ca să nu repeți `-f`/`--profile`
   (restul ghidului presupune asta):
   - **a) Caddy-ul inclus:** `COMPOSE_FILE=compose.prod.yaml` și `COMPOSE_PROFILES=proxy`.
     Apoi `cp Caddyfile.example Caddyfile` și înlocuiește `invoice.example.com` cu gazda
     din `PUBLIC_ORIGIN`.
   - **b) Proxy-ul tău, pe același server:**
     `COMPOSE_FILE=compose.prod.yaml:compose.loopback.yaml` și `APP_LOOPBACK_PORT=3180`.
     Proxy-ul trimite spre `http://127.0.0.1:3180` și păstrează neschimbate `Host` și
     `X-Forwarded-Proto` (altfel aplicația răspunde `400`); HSTS se pune în proxy. Exemple
     nginx și Caddy: [Quick start, pasul 5](../README.md#quick-start-self-host).
4. Generează secretele:
   ```bash
   scripts/init-secrets.sh
   ```
   Scriptul citește căile din `.env` (`AUTH_TOKEN_PATH`, `PG_PASSWORD_PATH`,
   `COMPANY_LOOKUP_KEY_PATH`, `ANAF_TOKEN_KEY_PATH`; implicit în `.local/`) și creează patru
   fișiere cu mod 0600: tokenul API, parola PostgreSQL, cheia căutării de firme și cheia
   tokenurilor ANAF. Nu suprascrie un fișier existent și nu afișează niciun secret. În
   producție căile pot sta în afara repository-ului; cele relative se rezolvă față de `.env`.

   **Parola bazei se generează o singură dată.** PostgreSQL o citește doar când creează
   clusterul, la primul start. Regenerată după aceea, `migrate` și `app` nu se mai conectează
   (`password authentication failed`). La fel, o cheie nouă de căutare face ilizibilă cheia
   openapi.ro salvată, iar o cheie ANAF nouă cere reconectarea cu certificatul. Schimbarea
   parolei: [Rotate it, keeping the data](../README.md#rotate-it-keeping-the-data).
5. Construiește imaginea și pornește:
   ```bash
   docker build -t qwbe-invoicing:local .
   docker compose up -d
   ```
   `db` pornește primul, `migrate` aplică schema, `app` pornește doar dacă migrarea a
   reușit, iar `caddy` (varianta a) așteaptă ca `app` să fie `healthy`.
6. Verifică:
   ```bash
   docker compose ps
   docker compose exec app node bin/qwbe-invoicing.ts doctor --json
   curl -fsS https://facturi.exemplu.ro/health/ready
   ```
   `app` trebuie să fie `healthy`. `doctor` verifică conexiunea la bază, migrările, drift-ul
   de schemă, directorul de PDF-uri, organizația și fișierul tokenului, și iese cu cod nenul
   dacă o verificare pică. Dacă ceva nu pornește: `docker compose logs --tail=100 migrate app`.

Instalarea dintr-un release publicat (imagine din registry, fixată pe digest):
[Installation](../README.md#installation) și [`docs/RELEASE.md`](./RELEASE.md).

## 4. Configurare minimă

| Variabilă în `.env` | Ce face |
|---|---|
| `PUBLIC_ORIGIN` | singura origine acceptată; `Host`, `X-Forwarded-*` și `Origin` trebuie să coincidă cu ea |
| `ORGANIZATION_ID` | firma deservită; nu se schimbă după primul start |
| `QWBE_PLUGINS` | plugin-urile pornite: absentă = toate, goală = niciunul, nume necunoscut = refuz la pornire |
| `QWBE_TRUSTED_PROXY` | proxy-urile ale căror `X-Forwarded-For` contează la limitarea încercărilor de login |
| `QWBE_BEARER_API` | `off` implicit; `on` deschide API-ul cu token Bearer pe aceeași adresă |

O schimbare cere repornirea (`docker compose up -d`). Tabelul complet:
[Configuration](../README.md#configuration).

Primii pași în aplicație (până îi termini, pagina **Acasă** arată cardul „Configurare
incompletă”, cu ce mai lipsește și linkul spre locul unde se rezolvă):

1. **Login.** Deschide `PUBLIC_ORIGIN`, introdu tokenul API (conținutul fișierului de la
   `AUTH_TOKEN_PATH`) și apasă „Deblochează aplicația”. Browserul păstrează doar o sesiune.
2. **Firma emitentă.** În **Setări** (pagina **Date firmă**): forma juridică (SRL sau PFA),
   denumirea, CUI-ul, Registrul Comerțului, capitalul social (la SRL), adresa, IBAN-ul și
   regimul TVA. Fără Registrul Comerțului (și capital, la SRL) nu se poate emite.
3. **Seriile.** Pe aceeași pagină, în **Serii de documente**, adaugi cu „Adaugă seria” cel
   puțin o serie pentru „Factură” (și una pentru „Proformă”, dacă le folosești). O serie
   adăugată nu se mai editează.
4. **Căutarea firmelor** (opțional). În **Integrări** alegi furnizorul: ANAF
   (gratuit, fără cheie) sau openapi.ro (cu cheia ta); cel mult unul pornit.
5. **Primul client** (opțional). În **Clienți**: o firmă cu CUI valid sau o persoană fizică,
   cu CNP opțional. Poți factura și unui cumpărător scris direct în factură.
6. **Prima factură.** **Facturi → Factură nouă**, completezi rândurile, apoi „Emite factura”.
   Numărul se alocă la emitere; factura emisă nu se mai modifică, se corectează prin storno.

## 5. Conectarea la ANAF e-Factura

Opțional, cu plugin-ul `efactura` pornit. Fără pașii de mai jos aplicația merge normal, iar
XML-ul fiecărei facturi se descarcă și se încarcă manual. Ce înregistrezi la ANAF:
[`docs/ANAF.md`](./ANAF.md).

De la ANAF ai nevoie de:

- **acces în SPV** pentru CUI-ul emitentului (reprezentantul legal sau o persoană
  împuternicită);
- **certificat digital calificat** al celui care face conectarea, instalat în browserul
  lui; se prezintă doar la `logincert.anaf.ro`, aplicația nu îl primește;
- **o aplicație OAuth înregistrată în portalul ANAF** („Editare profil Oauth”), grant type
  Authorization Code, cu callback-ul exact `https://facturi.exemplu.ro/api/anaf/callback`
  (`PUBLIC_ORIGIN` + `/api/anaf/callback`). ANAF afișează client id-ul și client secret-ul.

Pași:

1. Cheia tokenurilor (`ANAF_TOKEN_KEY_PATH`) există deja de la `scripts/init-secrets.sh`; pe
   o instalare mai veche rulează-l din nou, adaugă doar ce lipsește.
2. Scrie client secret-ul în fișierul lui, fără să apară pe ecran sau în istoricul shell-ului
   (bash; aceeași comandă ca în [e-Factura with ANAF](../README.md#e-factura-with-anaf), pasul 3):
   ```bash
   mkdir -p -m 700 .local
   ( umask 077; set -C; printf 'ANAF client secret: '; IFS= read -rs secret; echo; printf '%s' "$secret" > .local/anaf-client-secret )
   ```
3. Completează `.env`, cu `compose.anaf.yaml` adăugat la `COMPOSE_FILE`-ul de la instalare
   (varianta b: `compose.prod.yaml:compose.loopback.yaml:compose.anaf.yaml`):
   ```bash
   COMPOSE_FILE=compose.prod.yaml:compose.anaf.yaml
   ANAF_ENVIRONMENT=test
   ANAF_CLIENT_ID=<client id de la ANAF>
   ANAF_REDIRECT_URI=https://facturi.exemplu.ro/api/anaf/callback
   ANAF_CLIENT_SECRET_PATH=./.local/anaf-client-secret
   ```
   Toate valorile sau niciuna: o configurare parțială oprește Compose sau aplicația.
   `ANAF_REDIRECT_URI` este exact cel înregistrat la ANAF.
4. Repornește: `docker compose up -d`.
5. În **Integrări → ANAF e-Factura** apasă „Conectează cu certificatul”: browserul
   merge la ANAF, alegi certificatul, ANAF te trimite înapoi la callback. Aplicația verifică
   dreptul pe CUI-ul emitentului și nu salvează conexiunea fără el; tokenurile rămân în bază,
   criptate.
6. Trimite o factură de probă cu „Trimite în e-Factura”, din pagina ei, și urmărește starea
   până la „Înregistrată în e-Factura”.

**Trecerea pe producție.** `ANAF_ENVIRONMENT=prod` se pune doar pe serverul de producție;
repornești și te conectezi din nou cu certificatul. Aplicația refuză să pornească pe `prod`
dacă baza are trimiteri făcute pe `test` (și invers), deci proba pe TEST se face pe o
instalare separată sau pe o bază recreată înainte de trecere.

Facturile către persoane fizice (B2C) se trimit din același buton: aplicația le încarcă prin
`uploadb2c`, cu CNP-ul clientului dacă e completat, altfel cu 13 zerouri.

Fluxul în detaliu: [Connecting to ANAF](./EFACTURA.md#connecting-to-anaf-oauth-t-1346) și
[Submitting to ANAF](./EFACTURA.md#submitting-to-anaf-t-1346).

## 6. Backup, restaurare, actualizare

**Backup**, cu aplicația oprită (altfel comanda refuză) și cu `--no-deps`, ca să nu
pornească `migrate`:

```bash
mkdir -p /opt/qwbe-invoicing/backups
docker compose stop app
docker compose run --rm --no-deps -v /opt/qwbe-invoicing/backups:/backup app node bin/qwbe-invoicing.ts backup --output /backup/qwbe-$(date +%F).tar.gz --json
docker compose start app
```

Arhiva conține baza și PDF-urile, nu și `.env`, fișierele secrete, `Caddyfile` sau
conexiunea ANAF: pe acestea le salvezi separat, iar după o restaurare te reconectezi la ANAF.
O restaurare cere același `ORGANIZATION_ID`.

**Restaurarea** se face doar într-o bază nouă, goală, și într-un volum de date nou; `restore`
fără `--apply` doar verifică arhiva. Pașii: [Data, backup and restore](../README.md#data-backup-and-restore)
și [Restore](./RELEASE.md#restore). În producție, dintr-un checkout, `scripts/production/backup.sh`,
`restore.sh` și `deploy.sh` fac acești pași ([Production scripts](./RELEASE.md#production-scripts)).

**Actualizarea** dintr-un checkout: backup întâi, păstrezi imaginea veche pentru rollback,
apoi construiești și pornești:

```bash
docker tag qwbe-invoicing:local qwbe-invoicing:previous
git pull
docker build -t qwbe-invoicing:local .
docker compose up -d
docker compose exec app node bin/qwbe-invoicing.ts doctor --json
```

Release-uri publicate și rollback: [Upgrading](../README.md#upgrading) și
[Rollback](./RELEASE.md#rollback). `docker compose down -v` șterge baza, PDF-urile și
staging-ul de backup: nu e niciodată un pas de actualizare sau de backup.

## 7. Probleme frecvente

| Simptom | Cauză și rezolvare |
|---|---|
| `bind source path does not exist: .../pg-password` la `up` | lipsește un fișier secret: rulează `scripts/init-secrets.sh` și `up` din nou; clusterul nu a fost creat, nu ai ce șterge |
| `password authentication failed` | parola a fost regenerată după primul start; pune la loc fișierul vechi sau urmează [rotirea parolei](../README.md#rotate-it-keeping-the-data) |
| `migrate` iese cu `schema does not match the migration contract (...); recreate the database` | drift de migrare: noua versiune a schimbat schema de bază. Cât proiectul e în dezvoltare nu există upgrade între scheme, baza se recreează (README, [API](../README.md#api), „Schema during development”) |
| `400` la orice cerere prin proxy | `Host` sau `X-Forwarded-Proto` diferă de `PUBLIC_ORIGIN`; verifică proxy-ul și gazda din `Caddyfile` |
| `404` pe plăți sau e-Factura | plugin-ul e oprit în `QWBE_PLUGINS`; datele rămân și reapar când îl pornești |
| aplicația nu pornește după o schimbare în `QWBE_PLUGINS` | nume de plugin necunoscut; eroarea listează numele valide |
| `backup requires the application to be stopped` | `app` rulează: `docker compose stop app`, apoi backup |
| ANAF: „Necesită reconectare” | cheia tokenurilor, client id-ul sau mediul s-au schimbat, ori ANAF a refuzat reîmprospătarea; reconectează-te cu certificatul |
| ANAF: conexiunea nu se salvează (`fara_drept_cif`) | certificatul nu are drept în SPV pe CUI-ul emitentului din **Date firmă** |
| aplicația nu pornește după `ANAF_ENVIRONMENT=prod` | baza are trimiteri pe `test`; vezi „Trecerea pe producție” |
