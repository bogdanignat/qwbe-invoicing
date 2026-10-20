# ANAF: ce înregistrezi singur

Fiecare instalare își face propria relație cu ANAF. Repository-ul nu conține, și nu va
conține, chei, certificate sau aplicații OAuth ale cuiva: le înregistrează operatorul
instalării, pe firma lui.

## Ce face aplicația azi

| Funcție | Ce cere de la ANAF | Unde se configurează |
| --- | --- | --- |
| e-Factura (plugin `efactura`) | pentru XML, nimic; pentru SPV (conexiune OAuth, trimitere, stare, recipisă, reconciliere), aplicația OAuth a operatorului și accesul firmei în SPV, mai jos | `QWBE_PLUGINS`; variabilele `ANAF_*` și `compose.anaf.yaml`; conexiunea din **Setări → Integrări**; XML-ul se descarcă din factură (`GET /api/invoices/{id}/efactura.xml`, `GET /api/corrections/{id}/efactura.xml`) |
| Căutare firmă după CUI (plugin `company-lookup`, furnizor ANAF) | nimic: serviciul public de verificare TVA, fără cheie | **Setări → Integrări** în aplicație |

**Aplicația trimite în SPV doar ce trimite utilizatorul**, document cu document, și
numai cu plugin-ul `efactura` pornit și firma conectată la ANAF prin OAuth (T-1346, vezi
[`EFACTURA.md`](EFACTURA.md), „Submitting to ANAF”). Dispatcher-ul validează XML-ul, îl
încarcă în SPV (`api.anaf.ro`), urmărește starea și păstrează recipisa ANAF. Fără
conexiune, XML-ul se descarcă și se încarcă manual, pe canalul pe care îl folosești deja.

La validatorul public ANAF ajung două feluri de documente. Fixture-urile și orice
încărcare manuală conțin doar date inventate („Validating the fixtures” din
`EFACTURA.md`). Dispatcher-ul, în schimb, trimite XML-ul real al fiecărei trimiteri, și
pe `test`, și pe `prod`, la `webservicesp.anaf.ro/prod/FCTEL/rest/validare`, fără token,
înainte de upload. Validatorul e tot al ANAF, același operator ca SPV, iar validarea nu
înregistrează nimic în SPV.

## Ce înregistrezi pentru transmiterea în SPV

Codul folosește tot ce e aici (T-1346): conexiunea OAuth, trimiterea, starea, recipisa și
reconcilierea unei trimiteri `unknown` ([`EFACTURA.md`](EFACTURA.md)). Pașii de
înregistrare sunt în [`LOCAL_DEVELOPMENT.md`](LOCAL_DEVELOPMENT.md), „ANAF e-Factura
(OAuth client)”. Ce nu se poate deduce din cod rămâne marcat **de verificat** și se
confirmă pe documentația oficială ANAF.

1. **Accesul firmei în SPV.** Reprezentantul legal, sau o persoană împuternicită, are
   acces în Spațiul Privat Virtual pentru CUI-ul emitentului configurat în aplicație. La
   conectare, aplicația verifică dreptul tokenului pe acest CUI și nu salvează conexiunea
   fără el (`fara_drept_cif`). Forma exactă a împuternicirii: **de verificat**.
2. **Certificat digital calificat** al persoanei care se conectează, înregistrat în SPV.
   Se prezintă doar în browser, la `logincert.anaf.ro`, când se face conexiunea; aplicația
   nu îl primește și nu îl stochează.
3. **Aplicație OAuth înregistrată la ANAF**, pe numele operatorului, cu grant type
   Authorization Code. ANAF dă un client id și un client secret.
   - Callback-ul este exact `https://<gazda din PUBLIC_ORIGIN>/api/anaf/callback`, aceeași
     valoare în `ANAF_REDIRECT_URI`; client id-ul intră în `ANAF_CLIENT_ID`, secretul
     într-un fișier (`ANAF_CLIENT_SECRET_PATH`), iar tokenurile se criptează cu cheia din
     `ANAF_TOKEN_KEY_PATH`.
   - Aplicația nu cere niciun scope și nu trimite `state` (ANAF închide sesiunea cu el).
     Tokenul de acces se reîmprospătează când mai are sub 7 zile; cât trăiește tokenul de
     refresh nu spune ANAF, aplicația îl consideră 365 de zile: **de verificat**.
   - Mediul se alege cu `ANAF_ENVIRONMENT` (`test` implicit, `prod` doar scris explicit);
     adresele sunt constante în `kernel/efactura/anaf/endpoints.ts`, iar validarea merge
     în ambele medii la validatorul public ANAF. `serve` refuză să pornească dacă baza are
     trimiteri făcute în celălalt mediu (`ANAF_ENVIRONMENT is prod, but e-Factura submissions
     exist for test; …`), deci proba pe TEST se face pe o instalare separată sau pe o bază
     recreată înainte de trecerea pe `prod`.

## Unde stau valorile

Toate intră prin overlay-ul `compose.anaf.yaml`, adăugat în `.env` după fișierul de bază:
`COMPOSE_FILE=compose.yaml:compose.anaf.yaml` (self-host:
`compose.prod.yaml:compose.anaf.yaml`). Fără el aplicația răspunde „neconfigurat”; o
configurare parțială e refuzată. Exemplul neutru e în `.env.example`.

- Valorile publice stau în `.env`: `ANAF_CLIENT_ID`, `ANAF_REDIRECT_URI` și
  `ANAF_ENVIRONMENT` (`test` implicit).
- Client secret-ul și cheia tokenurilor sunt fișiere montate ca Docker secrets, ca
  `api-token` și `pg-password`: în `.env` stau doar căile (`ANAF_CLIENT_SECRET_PATH`,
  `ANAF_TOKEN_KEY_PATH`), aplicația le citește din `ANAF_CLIENT_SECRET_FILE` și
  `ANAF_TOKEN_KEY_FILE`. Niciodată ca valori în mediu, în `.env`, în imagine sau în git.
- Cheia tokenurilor (64 de caractere hex) o creează `scripts/init-secrets.sh`; secretul
  clientului îl scrie operatorul, din portalul ANAF. Tokenurile ANAF stau doar în bază,
  criptate cu acea cheie.
