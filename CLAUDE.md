# Invoicing QWBE — reguli de proiect

## STADIU: DEZVOLTARE. Nu exista date de productie.

Regula care are prioritate peste orice instinct de prudenta:

**Continutul bazei de date nu conteaza.** Nu exista utilizatori, nu exista facturi
reale, nu exista istoric de protejat. Baza se poate sterge si recrea oricand.

Consecinte directe, obligatorii:

- **Nu propune backfill, migrari retro-compatibile, coloane nullable "pentru
  datele vechi" sau fallback la randare pentru documente emise anterior.** Daca
  o schimbare de schema cere date noi, se cer pur si simplu: coloane NOT NULL,
  si baza se recreeaza.
- **Nu trata imutabilitatea documentelor emise ca pe o constrangere de migrare.**
  Triggerele de imutabilitate (`*_no_update`, `*_no_delete`) sunt corecte ca
  regula de business in runtime, dar in dezvoltare nu blocheaza nimic: stergi
  baza si o refaci.
- **Nu intreba ce se intampla cu inregistrarile existente.** Raspunsul e mereu
  acelasi: se sterg.
- **Nu adauga cod defensiv pentru forme vechi de date.** Modelul curent e
  singurul model.

Se poate reveni la prudenta de productie doar cand aceasta sectiune e modificata
explicit.

## Ce ramane valabil

Corectitudinea fiscala si de domeniu ramane obligatorie — conformitatea legala a
documentelor emise (elemente obligatorii pe factura, numerotare, TVA, storno) nu
e afectata de faptul ca suntem in dezvoltare. Prudenta se elimina doar in raport
cu **datele deja stocate**, nu cu **regulile de business**.

Quality gates raman obligatorii: `pnpm verify` (lint, typecheck, teste, package,
size, boundaries) trebuie sa fie verde inainte de commit.
