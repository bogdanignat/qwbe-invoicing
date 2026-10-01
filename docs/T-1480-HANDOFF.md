# T-1480 — verificare finala PASS, 2026-10-01

## Stare actuala (supersedeaza pauza de mai jos)
Implementarea si fixurile runtime sunt validate. Frozen install 430 exit0; full verify `.local/t-1480/431-full-verify.log` exit0: 1207/1207 teste, frontend-runtime 8/8, toate gate-urile PASS. Re-review Opus PASS: `.local/t-1480/accepted-runtime-review.md` (observatii low/info neblocante consemnate acolo). Detalii fixuri: `.local/t-1480/{resume-worker-report,review-fixes-report,shutdown-final-report}.md`.

Branch feat/T-1480-postgresql, cod NECOMIS. Fara deploy/reset; workerii de implementare terminati. Env local principal oprit; `.local/pg-password` lipseste, `.local/api-token` exista. Operatorul poate pregati secretul PG si rula build/up local; Traefik/TLS/UI live raman de verificat dupa pornire. Nu regenera tokenul existent, nu sterge volume. Commit doar la cerere.

## Handoff istoric de la pauza (pasii de reluare de mai jos sunt incheiati)

## Stare
Repo `/home/bogdan/projects/invoicing-qwbe`, branch `feat/T-1480-postgresql`, HEAD `b3ebd4c`. Implementarea este APROBATA; nu mai cere acord pe plan. Working tree mare, inclusiv fisiere NOI UNTRACKED si stergeri/rename STAGED. Toate sunt munca taskului: NU reset/clean/checkout peste ele. Fara commit/push/deploy/reset al datelor existente. La pauza nu mai exista worker sau teste active cu cwd-ul repo-ului.

PG16-only standalone, Docker-only, Effect/porturi pastrate, fara migrare date/mother/dual-engine. Schema, adaptoare, pool/tx, sesiuni async, HTTP/CLI, fingerprint/drift, backup/restore, compose x3 si boundaries implementate. Vechile module SQLite eliminate; JSON-urile `standalone/parity/sqlite-*` sunt golden fixtures istorice, NU recaptura/sterge.

## Dovezi obtinute (nu echivaleaza cu poarta finala)
- Schema: 177 verificari; adaptoare: 23 teste; review schema+adapters PASS.
- Backup/restore: 32 teste; ultimul review OPS PASS. Trusted SQL dump explicit, warning CLI, secret numai env copil, restore numai tinta fresh/goala; interop BusyBox tar ambele sensuri PASS.
- Runtime: recovery maintenance/fingerprint/readiness testate PG16; history per-scope reparat (pending nou != gaura corupta). Live independent de DB, secrets nondev fail-closed, cleanup serve la listen failure.
- Ultima suita `pnpm test`: 1194/1194 PASS, lint/typecheck PASS; apoi doua teste CLI reale suplimentare au trecut separat: EADDRINUSE -> exit1 + lock liber; DB down -> live200/ready503/SIGTERM bounded.
- Compose dev/prod/preview: build real client16.15, boot izolat, API/PDF/eFactura smoke PASS; boundary fixture12PASS/reguli25. Nu deploy. Traefik real/TLS80/443 neverificate.
- ULTIMUL `pnpm verify` complet: FAIL, 1190 teste/1187 PASS/3 FAIL (preview roster, history expectation, cross-DB kill din test). Aceste 3 au fost reparate; full verify NU a fost rerulat dupa toate fixurile.

## Ultimul worker OPRIT de user, modificari partiale NEVALIDATE
A reparat deja pe disc `probes/frontend-runtime-fixture.mjs` (startServer necesita pool, lifecycle async) si `standalone/storage/postgres-maintenance.test.ts` (peer/killer prin createQueryPool, nu raw PostgresSettings). Nu exista raport final/verificare pentru aceasta ultima runda. Citeste diff-ul, nu reface orb.

## Reluare — ordine
1. Status/diff; inspecteaza cele doua fixuri partiale. Ruleaza in Docker testul maintenance + build frontend/test:frontend:runtime. Audit raw new Pool cu campuri PostgresSettings camelCase: acestea NU sunt optiuni pg.
2. Inchide resturile mici din ultima runda: README inca descrie SQLite activ; help CLI backup/restore are texte vechi; verifica `process.exitCode=1` inainte de await cleanup pe serve failure. Actualizeaza finalul docs/T-1480-tests.md, fara claims stale.
3. Fara workeri care editeaza: `./scripts/verify-docker.sh install` (frozen), apoi `./scripts/verify-docker.sh verify`. Pastreaza output COMPLET si exit real, fara pipe tail care mascheaza eroarea. Repara orice fail; NU skip/reduce assertions.
4. Re-review Opus runtime/test-delivery pe ultimele fixuri; OPS si schema/adapters deja PASS. Nu declara DONE pana full verify verde. Commit numai la cerere.

Detalii persistente: docs/T-1480-{baseline,pg-driver,schema,adapters,integration,ops,tests}.md, docs/LOCAL_DEVELOPMENT.md, loguri `.local/t-1480`. Task hub T-1480 contine planul integral. Nu depinde de /tmp (se poate pierde la restart).

Riguri Docker PG tmpfs ramase pornite: verify, test, pg-adapters, pg-driver-probe, pg-probe. Doar teste. 11 volume smoke throwaway ramase; NU sterge autonom volume. Nicio baza aplicatie veche resetata.
