# ANAF: ce înregistrezi singur

Fiecare instalare își face propria relație cu ANAF. Repository-ul nu conține, și nu va
conține, chei, certificate sau aplicații OAuth ale cuiva: le înregistrează operatorul
instalării, pe firma lui.

## Ce face aplicația azi

| Funcție | Ce cere de la ANAF | Unde se configurează |
| --- | --- | --- |
| XML e-Factura (plugin `efactura`) | nimic | `QWBE_PLUGINS`; XML-ul se descarcă din factură (`GET /api/invoices/{id}/efactura.xml`, `GET /api/corrections/{id}/efactura.xml`) |
| Căutare firmă după CUI (plugin `company-lookup`, furnizor ANAF) | nimic: serviciul public de verificare TVA, fără cheie | **Setări → Integrări** în aplicație |

**Aplicația nu trimite nimic în SPV.** Generează XML-ul UBL 2.1 / CIUS-RO al facturii
emise; transmiterea, preluarea stării și a recipisei nu sunt implementate (T-1346,
vezi [`EFACTURA.md`](EFACTURA.md)). Până atunci XML-ul se descarcă și se încarcă manual,
pe canalul pe care îl folosești deja (SPV, aplicația ANAF sau alt furnizor). Validarea
XML-ului înainte de încărcare e descrisă în `EFACTURA.md`, „Validating the fixtures”;
la validatorul public ANAF ajung doar documente cu date inventate.

## Ce va trebui înregistrat pentru transmiterea în SPV

Nimic de aici nu e folosit încă de cod. Lista e ce trebuie pregătit pentru T-1346; tot ce
nu se poate deduce din cod e marcat **de verificat** și se confirmă pe documentația
oficială ANAF, nu pe acest fișier.

1. **Accesul firmei în SPV.** Reprezentantul legal, sau o persoană împuternicită, are
   acces în Spațiul Privat Virtual pentru CUI-ul emitentului configurat în aplicație.
   Forma exactă a împuternicirii: **de verificat**.
2. **Certificat digital calificat** al persoanei care se autentifică, înregistrat în
   SPV. Certificatul rămâne la operator (token sau browser): aplicația nu îl primește
   și nu îl stochează. Rolul lui exact în fluxul OAuth al API-ului e-Factura:
   **de verificat**.
3. **Aplicație OAuth înregistrată la ANAF**, pe numele operatorului. La înregistrare se
   declară un URL de callback și se primesc un client id și un client secret.
   - Callback-ul va fi pe originea instalării, `PUBLIC_ORIGIN`
     (de exemplu `https://invoice.example.com/...`). Calea exactă se stabilește odată
     cu T-1346: **de verificat**.
   - Unde se înregistrează aplicația, ce câmpuri cere formularul, ce scope-uri există și
     cât trăiesc token-urile: **de verificat**.
   - Mediul de test față de cel de producție al ANAF și adresele lor: **de verificat**.
     Repository-ul nu fixează nicio adresă de API e-Factura.

## Unde vor sta valorile

Azi nicio cheie de configurare nu le citește. Regula instalării se aplică și lor,
când vor exista:

- Client secret-ul și orice token sunt secrete: fișiere montate ca Docker secrets, ca
  `api-token` și `pg-password` (`AUTH_TOKEN_PATH`, `PG_PASSWORD_PATH` în `.env`), niciodată
  variabile de mediu, niciodată în `.env`, în imagine sau în git.
- Valorile publice (client id, callback) pot sta în `.env`, cu un exemplu neutru în
  `.env.example`.
- Numele cheilor se stabilesc în T-1346 și se adaugă atunci în `.env.example`,
  `compose.prod.yaml` și README.
