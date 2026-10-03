# T-1480 step 3 — the schema contracts on PostgreSQL 16, the executor, and gate G1

Branch `feat/T-1480-postgresql`, HEAD `b3ebd4c` (no commit, no push). Everything
below ran in Docker; the host has no Node, pnpm or PostgreSQL client in play.
Captured 2026-10-01.

This step translates the five `migrations.json` contracts and
`cube/invoicing/documents/contracts/migrations.ts` **in place** to PostgreSQL 16,
adds the foundation scope and the asynchronous migration executor in
`standalone/storage/postgres-*.ts`, and proves both with a gate that runs only
against a throwaway PostgreSQL 16 cluster.

It deliberately does **not** port the business adapters, the session store, the
HTTP layer, the backup/restore commands or the legacy SQLite tests. Those stay
visibly unported: `standalone/storage/migrations.ts` and
`sqlite-migration-replay.ts` were not touched, so the SQLite executor now fails
on the translated SQL instead of silently accepting a second dialect. See
§5 for exactly what that costs today.

## 1 What the contracts now contain

| File | Scope | Statements |
|---|---|---|
| `cube/invoicing/customers/contracts/migrations.json` | `customers` | 3 |
| `cube/invoicing/catalog/contracts/migrations.json` | `catalog` | 2 |
| `cube/invoicing/issuer/contracts/migrations.json` | `issuer` | 2 |
| `cube/invoicing/contracts/migrations.json` | `invoicing` | 92 |
| `cube/payments/contracts/migrations.json` | `payments` | 10 |
| `cube/invoicing/documents/contracts/migrations.ts` | `documents` | 12 |
| `standalone/storage/postgres-foundation.ts` | `foundation` | 1 |
| `standalone/storage/postgres-migration-plans.ts` | `standalone` | 2 |

The reference inventory of the SQLite baseline is preserved exactly:
**26 domain tables, 30 explicit indexes, 60 trigger behaviours, 98 CHECK
constraints**. PostgreSQL's physical object count is larger (implicit PK/UNIQUE
indexes, 7 functions, the ledger) and is not a parity criterion.

### Statement order, and the cycle

`invoicing` is the only baseline that had to be reordered. PostgreSQL rejects a
forward reference inside `CREATE TABLE` (probe (a), `42P01`), and the baseline
had four of them plus one real cycle. The new order is:

1. **17 `CREATE TABLE`**, topologically sorted — `document_series`,
   `invoice_sequences`, `audit_events`, `idempotency_records`, `invoice_drafts`,
   `proformas`, `issued_invoices`, `proforma_conversions`,
   `proforma_invoice_conversions`, `correction_documents`, then the five line and
   breakdown tables. The three former forward references
   (`proforma_conversions` → `proformas`/`invoice_drafts`,
   `proforma_invoice_conversions` → `proformas`) disappear by ordering alone.
2. **17 indexes**, including `CREATE UNIQUE INDEX
   proforma_invoice_conversions_lineage`, which is the parent key of the FK below
   and therefore has to exist first.
3. **One `ALTER TABLE`**, the only reference ordering cannot resolve:

   ```sql
   ALTER TABLE issued_invoices ADD CONSTRAINT issued_invoices_lineage_fkey
     FOREIGN KEY(organization_id,direct_source_proforma_id,id) REFERENCES
     proforma_invoice_conversions(organization_id,proforma_id,resulting_invoice_id)
     DEFERRABLE INITIALLY DEFERRED
   ```

   It closes the `issued_invoices` ↔ `proforma_invoice_conversions` cycle, its
   child column is `GENERATED ALWAYS AS … STORED`, and it keeps the original
   deferrability. The gate asserts the deferrability back out of
   `pg_get_constraintdef` and asserts that the key still fires **at `COMMIT`**
   (`23503`), not at `INSERT`.
4. **6 trigger functions**, then **51 triggers**.

Cross-scope order is unchanged and already safe: `foundation`, `customers`,
`catalog`, `issuer`, `invoicing`, `payments`, `documents`, `standalone`.

### The triggers, in two classes

All 60 triggers are `BEFORE … FOR EACH ROW` and all 60 raise `ERRCODE 23514`
with the SQLite message verbatim.

- **54 keep their predicate in `WHEN`** and share one foundation function:

  ```sql
  CREATE FUNCTION qwbe_abort() RETURNS trigger LANGUAGE plpgsql AS $qwbe$
   BEGIN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE=TG_ARGV[0]; END $qwbe$
  ```

  The message travels as a trigger argument, so the trigger reads
  `… EXECUTE FUNCTION qwbe_abort('<message>')` and the condition stays where it
  was. The 11 `UPDATE OF <columns>` triggers keep their column lists unchanged.
- **6 carry a subquery in `WHEN`**, which PostgreSQL does not allow there, so the
  predicate moved into the function body and the `WHEN` was dropped:
  `proforma_conversions_require_lineage`, `proforma_invoice_conversions_match`,
  `invoice_drafts_series_insert`, `issued_invoices_lineage_insert`,
  `proforma_lines_no_late_insert`, `proforma_tax_no_late_insert`. Each is
  `IF <predicate> THEN RAISE … END IF; RETURN NEW;` — a function that permits the
  write returns `NEW`, never `NULL`, which would suppress the row.

`invoice_drafts_series_update` is the only body that changed meaning-for-meaning:
SQLite's `IS NOT` became `IS DISTINCT FROM`, twice. The gate asserts
`NULL IS DISTINCT FROM 'INV'` is true and `'INV' IS DISTINCT FROM 'INV'` is false.

### Dialect translations

**`STRICT` is gone, and that is not neutral.** SQLite `STRICT` refused a REAL in
an INTEGER column (`cannot store REAL value in INTEGER column`); PostgreSQL
applies an assignment cast. Measured on the gate, in the gate:

- a **raw SQL numeric literal** rounds: `INSERT INTO invoice_sequences VALUES(…,7.5)`
  is accepted and stores `8`; `vat_registered` written as a raw `0.6` becomes `1`
  and satisfies `CHECK (vat_registered IN (0,1))`;
- a **bound parameter** does not: `$1` with the JS number `7.5` and `$1` with the
  text `'0.6'` both raise `22P02` (`invalid input syntax for type integer`),
  because a parameter is sent as text and gets no assignment cast.

Every storage adapter is parameterized, so the rounding path is not reachable
through the API, and the one caller-supplied integer that is not machine
allocated — `sector` — is already guarded at the domain boundary by
`Number.isInteger` (`cube/invoicing/parties/domain/party-validation.ts:38`).
Document numbers (`proformas.number`, `issued_invoices.number`,
`correction_documents.number`, `invoice_sequences.last_number`) are allocated by
the issuance sequence, not by callers, and `invoice_artifacts.byte_length` is a
buffer length. **No speculative numeric domain was introduced**: the plan's
choice of `integer` stands, and no claim is made that every SQL coercion is
equivalent between the two engines — the delta above is the record of where it
is not.

| SQLite | PostgreSQL | Where |
|---|---|---|
| `GLOB '[0-9]*.[0-9][0-9]'` | `~ '^[0-9].*\.[0-9][0-9]$'` | `product_presets.unit_price` |
| `NOT GLOB '*[^0-9.]*'` | `!~ '[^0-9.]'` | `product_presets.unit_price` |
| `substr(series,1,1) GLOB '[A-Z0-9]'` | `series ~ '^[A-Z0-9]'` | `document_series.series` |
| `series NOT GLOB '*[^A-Z0-9_-]*'` | `series !~ '[^A-Z0-9_-]'` | `document_series.series` |
| `substr(fingerprint,8) NOT GLOB '*[^0-9a-f]*'` | `substr(fingerprint,8) !~ '[^0-9a-f]'` | both idempotency tables |
| `json_valid(x)` | `x IS JSON` | 3 branding columns |
| `COLLATE NOCASE` | `translate(x,'A…Z','a…z') COLLATE "C"` | `product_presets_organization` |
| `IS NOT` | `IS DISTINCT FROM` | `invoice_drafts_series_update` |

**The catalog index is an expression index, and that is a contract for its
consumer.** `product_presets_organization` is now

```sql
CREATE INDEX product_presets_organization ON product_presets
  (organization_id,(translate(description,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')) COLLATE "C",
   id COLLATE "C")
```

An expression index is used only by a query that writes the **same expression**,
on **both** operands of a keyset comparison. `ORDER BY description` or
`ORDER BY lower(description)` will not use it — and `lower()` under a non-C
collation folds differently from `NOCASE` anyway. `id` carries `COLLATE "C"`
because it is the keyset tie-break and its order is part of the page contract;
`organization_id` does not, because it is only ever compared for equality, where
collation does not change the answer. The database is created `LC_COLLATE 'C'`,
so the explicit clauses are belt-and-braces, not a behaviour change.

All six GLOB occurrences are translated per conjunct and all are case-sensitive;
`~*`, `ILIKE` and `citext` are not used. The JSON columns stay **`TEXT` with an
`IS JSON` CHECK** and not `jsonb`: the probe showed `{"a":"\u0000"}` satisfies
`IS JSON` but `::jsonb` raises `22P05`, so a `jsonb` column would reject a
document SQLite accepts.

Money and dates stay `TEXT`. Booleans stay `INTEGER` with an `IN (0,1)` CHECK.
Counters, years, sectors and line positions are `integer`; the two session epochs
are `BIGINT`, and no global type parser is installed — decoding stays the
caller's explicit choice (driver probe g10).

### CHECK names

Every one of the 98 CHECKs now carries a deterministic
`CONSTRAINT <name>`; before, all were anonymous and PostgreSQL would have named
them `<table>_<column>_check1`, which is positional and therefore fragile for a
future fingerprint. The longest is
`correction_documents_customer_vat_registered_valid` (50 of the 63 allowed). The
gate asserts every name is ≤63 characters, unique, and does not end in
`_check<N>`.

## 2 The executor

| File | What it owns |
|---|---|
| `standalone/storage/postgres-foundation.ts` | `SchemaMigration`, `foundationScope`, `foundationMigrations` (`qwbe_abort`) |
| `standalone/storage/postgres-migration-plans.ts` | `MigrationScope`, the ordered `migrationScopes`, `migrationCount`, `migrationKey` |
| `standalone/storage/postgres-maintenance-lock.ts` | `maintenanceLockKey`, acquire/try/release in exclusive and shared mode |
| `standalone/storage/postgres-migrations.ts` | `SqlExecutor`, `MigrationReport`, `planMigrations`, `applyMigrations`, `applyMigrationsOnClient`, `databaseReady`, `ledgerTable` |

**Ownership is in the types**, and it is the contract the next step consumes:

- a function that takes a `Pool` checks a client out and gives it back
  (`applyMigrations`);
- a function that takes a `PoolClient` uses the caller's connection and never
  releases, destroys or ends it (`applyMigrationsOnClient`, every lock helper);
- `SqlExecutor = Pick<PoolClient, "query">` accepts both a `Pool` and a
  `PoolClient` for the read paths (`planMigrations`, `databaseReady`); the
  assignability of `Pool` to it was compiled, not assumed.

**The cluster precondition is asserted on the target, before the first write.**
`applyMigrationsOnClient` starts with `assertCollationC`, which reads
`datcollate`/`datctype` of `current_database()` and refuses anything but `C`/`C`.
Bracket expressions in regular expressions and uniqueness are collation
independent (so the CHECKs were never at risk); **index order is not**, and the
SQLite baseline ordered text binary. The gate proves the refusal on a database
it creates with `LC_CTYPE 'C.UTF-8'` and asserts that **nothing was created**
there.

**The maintenance barrier is taken in exactly one place, and with a bound.** `applyMigrations` is
the only entry point that calls `pg_advisory_lock`; `applyMigrationsOnClient` is
the same work on a connection the caller already holds the barrier on. That split
exists to prevent the self-deadlock the plan calls out: a caller holding the
exclusive lock must not re-enter a helper that acquires it again on a *different*
connection.

`applyMigrations` takes the barrier with `pg_try_advisory_lock` in a bounded
retry (`defaultLockBound` = 10 attempts × 300 ms) instead of the blocking
`pg_advisory_lock`: with the application up — it holds the barrier SHARED for the
life of its process — a blocking acquire would hang with no diagnostic. A held
barrier now fails with *"the application is running, stop it before migrating"*.
The release runs in a `finally` and **swallows its own failure**, so a dead
connection cannot replace the migration error with `Connection terminated`; in
that case the client is returned with `client.release(error)`, which destroys it
rather than handing a connection of unknown state back to the pool.
`postgres-maintenance-lock.ts` also ships the shared mode the running application
will hold; nothing in this step uses it outside the gate's fault case.

**The ledger is `schema_migrations(scope, name, applied_at)`**, primary key
`(scope, name)`. One database now holds every scope, so the bare name the three
SQLite files could afford is no longer unique. There is no checksum column: a
reapply is decided by presence, never by content. Each migration is applied in
its own transaction together with its ledger row — PostgreSQL DDL is
transactional, so a migration and its ledger row commit together or neither does.

The foundation is a single ledger row, scope `foundation`, applied once before
every cube scope. The consequence is a real coupling and is written down in the
contracts themselves: **the cube baselines are no longer self-sufficient SQL**,
they depend on a function `standalone/storage` owns.

## 3 Gate G1 and the parity matrix

`compose.pg-schema-gate.yaml` + `probes/pg-schema-gate.mjs`, with
`probes/pg-schema-seed-lib.mjs` and `probes/pg-schema-behaviour-lib.mjs`.
The rig is its own compose project, `postgres:16-alpine` pinned by digest, the
cluster on tmpfs, no published port, no reference to any application volume. The
gate creates every database it uses with `TEMPLATE template0 LC_COLLATE 'C'
LC_CTYPE 'C' ENCODING 'UTF8'` and drops them in a `finally`; names are validated
against `^gate_[a-z0-9_]+$` before interpolation.

It is **not** part of `pnpm test`. `pnpm test` still runs the SQLite suite, which
is why the gate has its own compose file and its own entry point.

**164/164 checks passed, exit 0**, three runs
(`.local/t-1480/70..72-schema-gate-run*.log`; run 1 failed one check and found a
real defect in the gate itself — see §4).

| Section | What it proves |
|---|---|
| G1 | `applyMigrations` on a fresh database changes all 8 migrations; a second run on the **same** database changes 0 and leaves `pending` empty; the inventory captured **before** the reapply equals the one captured after it; a **second fresh database** produces an identical inventory (tables, index definitions, constraint definitions, trigger definitions, function definitions) |
| collation | the created database answers `datcollate=C datctype=C encoding=UTF8` |
| inventory | 26 tables and 30 explicit indexes, compared **by name against the frozen SQLite capture** rather than against the generator; 60 triggers, 98 CHECKs, 7 functions; every CHECK name ≤63, unique, not auto-generated; the lineage FK still `DEFERRABLE INITIALLY DEFERRED` on `(organization_id, direct_source_proforma_id, id)` |
| triggers vs capture | every trigger compared against `standalone/parity/sqlite-baseline-triggers.json` — table, timing, event, `FOR EACH ROW`, the `UPDATE OF` column list, where the predicate lives, the predicate's semantic footprint and the raised message; plus the two lists (11 `UPDATE OF`, 6 moved predicates). The comparator is itself shown to report eight kinds of mutation, so it cannot pass vacuously |
| fault cases | a non-C database is refused before any write and stays empty; the same guard passes on a C database; a barrier held SHARED by another session makes `migrate` refuse inside its bound (<5 s) instead of hanging, and the next run succeeds once the holder releases |
| numeric | a raw numeric literal rounds into an integer column (the lost `STRICT`), a bound JS number and a bound text fraction are both refused with `22P02` |
| ownership | each scope's **real** `pg_class` delta in a composed schema equals the tables its cube manifest declares; `standalone` declares `browser_sessions` explicitly and the ledger is excluded; the comparison is shown to fail on a wrong owner and on an extra table |
| bare DDL | each scope applied alone on a fresh database: `customers`, `catalog`, `issuer` and `standalone` stand alone; `invoicing`, `payments` and `documents` fail, `documents` with `42883` (no `qwbe_abort`) |
| accept | 31 seed statements — issuer, tax configuration, series, customer, preset, three drafts, three proformas with lines and breakdown, sealing, invoices, lines, both conversion kinds, correction, audit, idempotency, payments and a reversal, both artifact tables, a session — all accepted, including the deferred cycle inside one transaction |
| triggers | one reject case per trigger, cross-checked both ways against `pg_trigger` so neither an uncovered trigger nor a case without a trigger can pass; each asserts `23514` **and** the exact message |
| constraints | generated column not writable (`428C9` only — `28C9` does not exist and was removed), FK (`23503`), unique (`23505`), NOT NULL (`23502`), four CHECK cases (`23514`) |
| deferred key | the `INSERT` is asserted to **succeed** and the `COMMIT` is asserted to fail with `23503`, as two separate statements on the same client and the same transaction — a `NOT DEFERRABLE` key would have failed at the `INSERT` |
| vectors | the 4 GLOB CHECK columns replayed with the **frozen SQLite outcomes** as the oracle (satisfied → insert accepted, violated → `23514`), and all 23 JSON vectors replayed through the real `issuers_branding_json` CHECK |
| folding | `translate(…)` folds ASCII only — `ĂLPHA` → `Ălpha` — which is what `NOCASE` did |

The trigger capture, the GLOB vectors and the JSON vectors are the
non-tautological part: the expected answers
come from `standalone/parity/sqlite-dialect-behavior.json`, captured on SQLite
before any translation existed, and are replayed as real inserts against the
translated CHECKs.

## 4 Defects found by running it

1. The gate's first inventory query treated `proforma_invoice_conversions_lineage`
   as implicit and reported 29 explicit indexes instead of 30. A foreign key's
   `pg_constraint.conindid` points at the **parent's** unique index, so joining on
   `conindid` alone hides a perfectly explicit index. Fixed by restricting the
   join to `contype IN ('p','u','x')`; the count went to 30 and the name matched
   the SQLite capture.
2. The trigger-parity query could not use `pg_get_expr(t.tgqual, t.tgrelid)`:
   a `WHEN` that mentions both `OLD` and `NEW` fails with
   `expression contains variables of more than one relation`. The predicate is
   read out of `pg_get_triggerdef` instead. `tgattr` also had to be cast to
   `text[]`; `COALESCE(…, '{}')` returned the literal string `{}`, so the first
   run compared character arrays.
3. `eslint` rejected the first gate: `'setTimeout' is not defined`,
   `'clearTimeout' is not defined`, `'URL' is not defined` ×2 (the flat config
   gives `.mjs` no browser globals) and `preserve-caught-error` on the seed
   wrapper. Imported from `node:timers`/`node:url` and attached the `cause`.

## 5 Verification

| Command | Log | Result |
|---|---|---|
| `docker compose --file compose.pg-schema-gate.yaml run --rm schema-gate` ×2 (before review) | `.local/t-1480/71`, `72` | 164/164, exit 0 |
| same, after the review fixes, ×3 | `.local/t-1480/83`, `84`, `87` | **177/177**, **177/177**, **177/177**, exit 0 |
| `scripts/verify-docker.sh run "pnpm lint && pnpm typecheck && pnpm gate:size && pnpm gate:boundaries"` | `.local/t-1480/86` | exit 0 — size gate passed, boundary cruise `no dependency violations found (790 modules, 3557 dependencies cruised)` |
| `pnpm exec tsc -p tsconfig.json --noEmit` with a `Pool → SqlExecutor` probe file | `.local/t-1480/76` | exit 0; probe file removed afterwards |
| `scripts/verify-docker.sh run "pnpm test"` | `.local/t-1480/77` | **exit 1, expected** |

### The legacy SQLite suite is red, on purpose

`pnpm test` now fails: **175 failing tests across 32 files**, all of them
executing the contracts through `node:sqlite`. The first failure is
`unrecognized token: "!"` at `sqlite-migration-replay.ts:8` — SQLite parsing the
PostgreSQL regular-expression operator. The 32 files are the storage suite, the
API/HTTP suites that boot the application, `standalone/ops/*`, the two frontend
proxy probes that start the app, and `probes/schema-inventory.test.mjs`, whose
`--check` drift gate compares a SQLite capture of contracts that are no longer
SQLite.

Nothing was skipped, disabled or deleted to hide that, and **`pnpm verify` is not
green**. The legacy executor was left untouched precisely so the gap stays
visible until the adapters are ported.

The frozen golden fixtures in `standalone/parity/` were not re-captured and not
modified.

## 6 API surface for the next step

```ts
import type { Pool, PoolClient } from "pg"

// postgres-migrations.ts
type SqlExecutor = Pick<PoolClient, "query">          // a Pool satisfies it too
const planMigrations: (executor: SqlExecutor) => Promise<MigrationReport>
const databaseReady: (executor: SqlExecutor) => Promise<boolean>
const assertCollationC: (executor: SqlExecutor) => Promise<void>         // throws on a non-C database
const defaultLockBound: { attempts: 10; delayMillis: 300 }
const applyMigrations: (pool: Pool, bound?: MaintenanceLockBound) => Promise<MigrationReport>  // bounded try
const applyMigrationsOnClient: (client: PoolClient) => Promise<MigrationReport>  // caller holds it
const ledgerTable: "schema_migrations"

// postgres-maintenance-lock.ts — all take a client the caller owns
const maintenanceLockKey: { classId: 1480; objectId: 1 }
const acquireMaintenanceLock: (client: PoolClient) => Promise<void>
const tryAcquireMaintenanceLock: (client: PoolClient) => Promise<boolean>
const acquireSharedMaintenanceLock: (client: PoolClient) => Promise<void>
const releaseMaintenanceLock: (client: PoolClient) => Promise<boolean>
const releaseSharedMaintenanceLock: (client: PoolClient) => Promise<boolean>

// postgres-migration-plans.ts
const migrationScopes: ReadonlyArray<{ scope: string; migrations: …; tables: readonly string[] }>
```

`MigrationReport` keeps the shape the CLI already prints:
`{ scanned, changed, skipped, failed, pending }`.

Open question left for the plan, not decided here (review `info`): a cube scope
creates functions in `public` (the 6 `qwbe_*` predicate functions) but
`MigrationScope.tables` only claims tables, so the ownership check does not cover
them, and the foundation coupling itself inverts the declared direction
("the cube is the deliverable, the host is replaceable"). Extending ownership to
functions, or moving `qwbe_abort` into a contract the cube owns, is a plan
decision.

Not in this step, and therefore still open for the next one: the fingerprint and
drift replay (the scratch schema is allowed `search_path = <scratch>, pg_catalog`
with **no `public` fallback`), the pool lifecycle and the 8 composition sites,
the typed error mapping, the business adapters, the session store, the HTTP
layer, backup/restore, the `pg` boundary rule, the config and compose wiring, and
the port of the dialect assertions in the legacy tests.

## 7 Reproducing

```sh
scripts/verify-docker.sh install                                          # frozen
docker compose --file compose.pg-schema-gate.yaml run --rm schema-gate    # 164 checks
docker compose --file compose.pg-schema-gate.yaml down                    # no volume, no -v
scripts/verify-docker.sh run "pnpm typecheck"
scripts/verify-docker.sh run "pnpm lint && pnpm gate:size && pnpm gate:boundaries"
```

Nothing above deletes a volume, publishes a port or touches an application
volume. The gate cluster lives on tmpfs and dies with its container; every
database the gate creates it also drops.

---

# Review fix pass — what changed, per finding

Review `/tmp/code-review.2N6U7b/review.md`, verdict `changes_requested`.
Scope of this pass: the 6 contracts, the 4 `standalone/storage/postgres-*.ts`
files, the G1 probe/rig and these docs. The pool/transaction/adapter files of the
parallel worker were not touched.

| Finding | Severity | Fix | Evidence |
|---|---|---|---|
| reapply comparator compared the inventory with itself | medium | the inventory is now captured **before** `applyMigrations` runs the second time (`probes/pg-schema-gate.mjs:127`) and compared with the post-reapply capture | check "reapply leaves the schema byte-identical with the first apply" |
| trigger parity was only numeric; `sqlite-baseline-triggers.json` unread | medium | new `probes/pg-schema-trigger-parity-lib.mjs`; the gate reads the golden and compares name, table, timing, event, `FOR EACH ROW`, `UPDATE OF` list, where the predicate lives, the predicate's semantic footprint and the raised message, plus both lists (11 / 6) | checks "every trigger matches the frozen SQLite capture", "the 11 UPDATE OF column lists and the 6 moved predicates match the capture", "the trigger comparator reports a mutated trigger (it is not vacuous)" (8 mutation kinds) |
| `releaseMaintenanceLock` failure masked the migration error | low | the release is wrapped; the original error propagates and the client is returned with `client.release(error)`, which destroys it | `standalone/storage/postgres-migrations.ts:180-190` |
| unbounded `pg_advisory_lock` on `migrate` | low | `pg_try_advisory_lock` in a bounded retry (`defaultLockBound` 10 × 300 ms), explicit "the application is running" message | check "a held barrier refuses the migration within its bound", with the barrier held SHARED by another session, and "the barrier is free again once the holder releases" |
| collation C never verified at migration | low | `assertCollationC` runs first in `applyMigrationsOnClient`, before any write | checks "the target locale really differs from C", "migration refuses a non-C database before writing anything" (and nothing was created), "the same guard passes on a C database" |
| deferred FK test could not tell `INSERT` from `COMMIT` | low | the two statements are asserted separately on the same client and transaction | checks "the deferred lineage key does not fire at INSERT" and "… fires at COMMIT with 23503" |
| `STRICT` loss undocumented | low | documented with measured numbers; **no speculative numeric domain added**, the plan's `integer` stands | checks "a raw numeric literal is assignment-cast and rounds", "a bound fraction (a JS number / a text fraction) is refused with 22P02", "a raw 0.6 rounds to 1 and satisfies CHECK IN(0,1)" |
| expression index is a consumer contract | low | the exact expression is written in the docs, with the reason `id` carries `COLLATE "C"` and `organization_id` does not | docs §1 |
| `28C9|428C9` accepted a non-existent SQLSTATE | info | only `428C9` | `probes/pg-schema-behaviour-lib.mjs:222` |
| ownership does not claim the 6 `qwbe_*` functions | info | recorded as an open plan decision, not changed here | docs §6 |
| `componentMaxLines` nominal | info | no action, as the review states | — |

## Blocker check requested by the brief

The brief asked whether the API port's typed validators and the parameterized
adapters reject a fraction in an integer field, and to report a blocker if not.
**They do, and there is no blocker:**

- a bound parameter never gets PostgreSQL's assignment cast, so `7.5` and `'0.6'`
  both raise `22P02` — asserted in the gate, twice;
- the only caller-supplied integer that is not machine-allocated, `sector`, is
  rejected by `Number.isInteger` in
  `cube/invoicing/parties/domain/party-validation.ts:38`;
- the rounding path needs a raw SQL numeric literal, which no adapter emits.

## Verification of this pass

| Command | Log | Result |
|---|---|---|
| `docker compose --file compose.pg-schema-gate.yaml run --rm schema-gate` ×3 | `.local/t-1480/83`, `84`, `87` | **177/177**, exit 0 each |
| `scripts/verify-docker.sh run "pnpm lint && pnpm typecheck && pnpm gate:size && pnpm gate:boundaries"` | `.local/t-1480/86` | exit 0, `no dependency violations found (790 modules, 3557 dependencies cruised)` |

Two defects of this pass were found by running it, not by reading it:
`pg_get_expr(tgqual, tgrelid)` fails with `expression contains variables of more
than one relation` for a `WHEN` that mentions both `OLD` and `NEW` (the predicate
is read from `pg_get_triggerdef` instead), and `COALESCE(array_agg(...), '{}')`
returned the literal string `{}` so the first comparison diffed character arrays
(cast to `text[]`).

The legacy SQLite suite stays red and nothing was skipped or disabled:
`pnpm test` → 175 failing tests across 32 files, `pnpm verify` is not green.
The frozen golden fixtures in `standalone/parity/` were not modified.
