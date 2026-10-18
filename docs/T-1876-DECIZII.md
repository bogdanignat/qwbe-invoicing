# T-1876: deciziile luate pe parcurs

Bogdan, 2026-10-18: „decide singură și du la capăt aplicația, keep it simple but safe; notează
deciziile într-un md și le examinăm la final”. Aici sunt toate deciziile luate în epic, fiecare
cu motivul ei. Planul a primit review de la Astra (hub review
`invoicing-qwbe-T-1876-plan-review-astra`).

## Direcția (decisă de Bogdan)

- Aplicația rămâne standalone: kernel propriu, PostgreSQL propriu, login propriu.
- Din `crm-pack` se copiază doar structura: un pachet `kind: "plugin"` și un părinte cu copii.
  Logica și datele nu se mută în mamă.
- `invoicing` e cubul principal. `payments` și `efactura` sunt pluginuri, adică cuburi-copil din
  același repo, pornite din config.
- Integrarea cu mama nu se implementează acum. Contractul ei e descris doar ca text.

## Deciziile mele

| # | Decizie | Motiv |
|---|---|---|
| 1 | Am făcut merge pe PR #52 (T-1874) înainte de epic. | Epicul pornește de la `kernel/` și `cubes/`; Bogdan a dat acordul. |
| 2 | Tot epicul stă pe un singur branch, `refactor/T-1876-pluginuri`, cu câte un commit pe task și un singur PR la final. | Regula „implementările mari neterminate stau pe branch separat până la final”. |
| 3 | Copiii obligatorii și pluginurile stau în aceeași ierarhie, marcați cu `required: true/false`. | Ierarhia spune cui aparține un cub, iar `required` spune dacă poate fi oprit. Câmpul are deja forma din `qwbe-core`. |
| 4 | Pluginurile păstrează numele `payments`/`efactura` și permisiunile actuale, inclusiv aliasurile. | Cheia ledger-ului de migrări și granturile rămân aceleași, deci nu e nimic de migrat. |
| 5 | PDF-ul rămâne în kernel; din kernel ies doar mapperele e-Factura. | PDF-ul are nevoie de fs și fonturi, deci e un adaptor de host. Mapperele sunt logică pură. |
| 6 | Pluginurile se aleg prin `QWBE_PLUGINS`. Absent: toate active. Gol: niciun plugin. Nume necunoscut: aplicația nu pornește. Orice schimbare cere restart. | E varianta cea mai simplă și refuză clar o configurare greșită. |
| 7 | Migrările rulează mereu complet, indiferent de config. | Schema rămâne una singură, iar datele se păstrează la oprire și repornire. |
| 8 | Când e-Factura e oprit, câmpul e `eFacturaStatus: null`, fără să fie scos din răspuns. | Contractul API rămâne stabil, iar UI-ul are o singură formă de tratat. |
| 9 | Nu pretindem compatibilitate cu checkerul `qwbe-core/package`; avem un contract local explicit. | Prefixul permisiunilor, `screen: true` și `contracts/index.ts` diferă de forma CRM. |
| 10 | Din scop au ieșit: installer, artifact builder pentru mamă, registry generic, hot reload, adaptorul mother-auth, dependența de `qwbe-core`. | Directia aleasă nu are nevoie de ele (Astra). |

Deciziile luate în timpul implementării se adaugă dedesubt.

| # | Decizie | Motiv |
|---|---|---|
| 11 | B1 și B2 se fac într-un singur pas. | Manifestul unic listează `invoicing/payments` și `invoicing/efactura`, căi care apar abia după mutare. Separat, unul dintre pași ar lăsa gate-urile roșii. |
| 12 | Manifestul de pachet stă la rădăcina repo-ului, numit `invoicing-pack`, `kind: "plugin"`, cu 11 unități. Manifestele din fiecare director dispar. | E forma din crm-pack: un singur inventar, judecat de gate-uri. |
| 13 | Documentația (A) și restructurarea (B) rulează în paralel, pe fișiere separate. | Câștig de timp fără conflicte: A atinge doar FOUNDATION/README/PRODUCT și nu rulează containerul de verificare. |
| 15 | **C (T-1880) anulat:** mapperele e-Factura rămân în `kernel/efactura/`, ca adaptor de host. | Pluginul efactura are 37.340 de caractere din bugetul de 40.000 pe unitate, iar mapperele mai aduc ~9.800. Ca să încapă, ar fi trebuit un cub-copil artificial, doar pentru bani. Aplicația are oricum toată logica; kernelul face parte din ea. Când pluginul e oprit, rutele XML nu se montează, deci mapperul nu e apelat. |
| 16 | O regulă de gate interzice unităților `required: true` să importe unități `required: false`. | Fără ea, primul import din nucleu spre un plugin ar rupe oprirea lui, fără ca vreun test să pice (review runda 1). |
| 17 | Gate-urile recunosc un cub prin încărcarea `index.ts` și verificarea exportului `cube`, nu după text. | O singură definiție de „cub” în toate gate-urile, care prinde și formele reexportate. Gate-urile rulează doar pe codul nostru, în containerul de verificare. |
| 14 | `.claude/CLAUDE.md` și `.architecture/contract.json` (locale, în afara git-ului proiectului) se actualizează după merge. | Descriu `main`; schimbate înainte, ar minți despre codul din `main`. |
