# T-1480 unit ADAPTERS — the PostgreSQL adapters, the pool, the transaction and the error map

Branch `feat/T-1480-postgresql`, HEAD `b3ebd4c` (no commit, no push). Everything
below ran in Docker. Captured 2026-10-01.

This unit adds **only new `postgres-*` files** under `standalone/storage`. The
four files the schema step produced (`postgres-foundation.ts`,
`postgres-migration-plans.ts`, `postgres-maintenance-lock.ts`,
`postgres-migrations.ts`) and the six schema contracts are untouched; so are the
three existing rigs, the HTTP layer, `BrowserSession`, the ops CLI, the shipped
compose files and `RuntimeConfig`. Nothing is wired yet: no composition site
calls any of this, and the running application is still SQLite. **Wiring is the
integration step's work, and this document is its contract.**

No dual-engine flag and no compatibility shim exists. The `sqlite-*` files are
left in place and unusable against the new schema; they are deleted at the final
switch.

## 1 The files

| File | What it owns |
|---|---|
| `postgres-pool.ts` | `PostgresSettings`, `PostgresQueries`, `PostgresRuntime`, `createQueryPool`, `createMaintenancePool`, `createPostgresRuntime`, `createQueryRuntime` |
| `postgres-transaction.ts` | `TransactionClient`, `QueryResult`, `AdvisoryLockKey`, `TransactionClosed`, the three logical lock keys, `transactionWith` |
| `postgres-errors.ts` | `WriteFailure`, `persistence`, `writeFailure`, `isConflict`, `sqlState`, `conflictSqlStates`, `redactSecrets`, `read`, `write` |
| `postgres-rows.ts` | row decoders (`text`, `integer`, `booleanInteger`, `epoch`, …), `addressFrom`/`partyFrom`/`buyerFrom`, `addressValues`, `addressColumns`, `booleanValue` |
| `postgres-sql.ts` | `QueryValue`, `SqlFragment`, `placeholders`, `valueList`, `fold`, `foldedOrder`, `nameKeyset`, `rowsWanted`, `insertStatement`, `assignExcluded`, `pairs`, `fragments` |
| `postgres-store.ts` | `createPostgresStore`, `createPostgresPaymentsStore`, `businessTransaction`, `ApplicationTransaction` |
| `postgres-kernel.ts` | `appendAuditEvent`, `kernelTransactionAdapter` |
| `postgres-series.ts` | `seriesTransactionAdapter` |
| `postgres-drafts.ts` | `draftsTransactionAdapter` |
| `postgres-invoices.ts` | `invoicesTransactionAdapter` |
| `postgres-invoice-register.ts` | `invoiceRegisterTransactionAdapter` |
| `postgres-customers.ts` | `customersTransactionAdapter` |
| `postgres-catalog.ts` | `catalogTransactionAdapter` |
| `postgres-issuer.ts` | `issuerTransactionAdapter` |
| `postgres-proformas.ts` | `proformasTransactionAdapter` |
| `postgres-proforma-writes.ts` | `saveProforma`, `proformaColumns` |
| `postgres-proforma-conversions.ts` | `proformaConversionsTransactionAdapter` |
| `postgres-corrections.ts` | `correctionsTransactionAdapter` |
| `postgres-correction-rows.ts` | `correctionFrom` |
| `postgres-payments.ts` | `paymentsTransactionAdapter`, `paymentsPersistence` |
| `postgres-document-lines.ts` | `saveLines`, `loadLines`, `taxBreakdownFrom`, `lineFrom`, `breakdownFrom`, `vatTreatment`, `lineColumns`/`lineValues`, `breakdownColumns`/`breakdownValues` |
| `postgres-document-rows.ts` | `issuedInvoiceFrom`, `proformaFrom`, `draftFrom` |
| `postgres-document-parties.ts` | `issuerFrom`, `issuerCompanyFrom`, `issuerCompanyDetailsFrom`, `brandingFrom`, `withoutIssuerBranding`, `issuerColumns` |
| `postgres-document-query.ts` | `sourceFrom`, `sourceValues`, `sourceColumns`, `sourceFilter`, `documentKeyset`, `draftKeyset` |
| `postgres-artifact-rows.ts` | artifact decoders and the two `same*` comparisons |
| `postgres-artifact-repository.ts` | `createPostgresArtifactRepository` |
| `postgres-artifacts.ts` | `createPostgresInvoiceSource` (re-exports the repository factory) |
| `postgres-rig.test-support.ts` | the test rig: `freshRuntime`, `emptyRuntime`, `createTestDatabase`, `sessionCount` |

None of them imports `node:sqlite` or any `sqlite-*` module; the cube ports are
unchanged and no new read-only API exists.

## 2 The API the integration step consumes

```ts
import type { Pool } from "pg"

// postgres-pool.ts
interface PostgresSettings {
  readonly host: string
  readonly port: number
  readonly database: string
  readonly user: string
  readonly password: string            // read from the secret file by the caller
  readonly maxConnections?: number      // default 4
  readonly connectTimeoutMillis?: number            // default 2_000
  readonly idleTimeoutMillis?: number               // default 10_000
  readonly statementTimeoutMillis?: number          // default 5_000
  readonly lockTimeoutMillis?: number               // default 3_000
  readonly idleTransactionTimeoutMillis?: number    // default 10_000
  readonly maintenanceStatementTimeoutMillis?: number // default 30_000
  readonly onPoolError?: (message: string) => void  // already redacted
}
interface PostgresQueries {                 // queries only — NO maintenance member
  readonly pool: Pool          // application queries, max = maxConnections
  readonly close: () => Promise<void>   // idempotent, memoised, message redacted
}
interface PostgresRuntime extends PostgresQueries {
  readonly maintenance: Pool   // separate, max 1, for the session-level lock
}
const createPostgresRuntime: (settings: PostgresSettings) => PostgresRuntime
const createQueryRuntime:    (settings: PostgresSettings) => PostgresQueries  // one pool
const createQueryPool:       (settings: PostgresSettings) => Pool
const createMaintenancePool: (settings: PostgresSettings) => Pool

// postgres-store.ts — every factory takes the pool, owns nothing
const createPostgresStore:         (pool: Pool) => TransactionalStore<ApplicationTransaction>
const createPostgresPaymentsStore: (pool: Pool) => PaymentsStore<PaymentsTransaction>
const businessTransaction: (pool: Pool) => <A, E, R>(
  use: (client: TransactionClient) => Effect.Effect<A, E, R>,
) => Effect.Effect<A, E | PersistenceFailure, R>

// postgres-artifacts.ts / postgres-artifact-repository.ts
const createPostgresInvoiceSource:       (pool: Pool) => InvoiceSource
const createPostgresArtifactRepository:  (pool: Pool) => ArtifactRepository

// postgres-transaction.ts
interface TransactionClient {
  readonly query: (sql: string, values?: ReadonlyArray<QueryValue>) => Promise<QueryResult>
}
interface QueryResult { readonly rows: ReadonlyArray<Row>; readonly rowCount: number }
const businessLockKey:  AdvisoryLockKey  // { classId: 1480, objectId: 2 }
const documentsLockKey: AdvisoryLockKey  // { classId: 1480, objectId: 3 }
const sessionsLockKey:  AdvisoryLockKey  // { classId: 1480, objectId: 4 } — reserved
const transactionWith: <T, F>(pool: Pool, options: TransactionOptions<T, F>) => …

// postgres-errors.ts
const writeFailure: (error: unknown, operation: string) => DomainConflict | PersistenceFailure
const isConflict:   (error: unknown) => boolean
const redactSecrets: (text: string) => string
```

**Ownership, stated once:** a factory takes a `Pool` and never creates, ends or
closes it. The process that builds the runtime calls `close()` exactly where it
decides to — once per CLI command in a `finally`, never for `serve`. `close()` is
idempotent, so a signal handler and a `finally` may both reach it.

**What the integration step still has to do** (deliberately absent here): the
`RuntimeConfig`/`.env`/compose keys and the secret-file read, acquiring the
SHARED maintenance lock on `runtime.maintenance` at boot with bounded retry and
the fail-closed readiness that follows, the 8 composition sites, the async
`api.dispose`, the browser session store (`sessionsLockKey` is reserved for it),
backup/restore, the `pg` boundary rule, and the port of the legacy dialect
assertions.

## 3 The decisions a reader has to know

**Locks, in this order on every transaction.** `pg_advisory_xact_lock_shared(1480,1)`
first — the same key `postgres-maintenance-lock.ts` owns, which `migrate`,
`backup` and `restore` take EXCLUSIVE — then `pg_advisory_xact_lock` on the
logical key, EXCLUSIVE. Business and payments share key 2 because they share one
transaction surface today; documents has key 3 so writing artifact metadata does
not serialise against issuance. Taking the logical lock first would deadlock
against maintenance. Isolation is READ COMMITTED (the default): the exclusive
logical lock is what serialises writers, so nothing retries and no external
effect is replayed. Reads take the same exclusive lock — there is no read-only
fast path, exactly as `BEGIN IMMEDIATE` had none.

**The handle has three phases, and that is what makes interruption safe.**
`Effect.tryPromise` with a zero-argument `try` compiles to a bare `OP_ASYNC` with
**no canceler** — read in the installed runtime, not assumed:
`core-effect.js` takes the `evaluate.length >= 1` branch only when the thunk
accepts an `AbortSignal`, and `core.js:async_` attaches `onInterrupt` only when
the register returns a canceler or an `AbortController` was created. Neither
happens, so an interrupt resumes the fiber and **abandons the running async
function**. Since an adapter body is multi-statement (`saveIssuedInvoice` sends a
header, N lines and M breakdown rows inside one `tryPromise`), the abandoned
continuation would otherwise keep writing on a connection the finalizer had
already rolled back and returned to the pool — in autocommit or inside the next
transaction. So the handle is `accepting` → `closing` → `returned`:
`executor.query` reaches the client only while `accepting` and otherwise throws
`TransactionClosed` **before any I/O**; both the commit and the finalizer set
`closing` BEFORE they drain, so nothing new can be enqueued while the
transaction is wound up; `drain()` loops
(`while (inFlight.size > 0) await Promise.allSettled([...inFlight])`) so a
statement enqueued in the same microtask window is still awaited before the
connection is touched. Proven by removing the guard: the test then records
`statement-2-accepted` instead of `statement-2-refused:TransactionClosed`
(`.local/t-1480/96-guard-removed.log`).

**The transaction handle.** `pool.connect()` and `BEGIN` run uninterruptibly; a
failure anywhere in the acquire destroys the client with `client.release(error)`
and rethrows, because `acquireUseRelease` does not run the finalizer for a failed
acquire (driver probe g16). The handle tracks every in-flight query, and both the
COMMIT and the finalizer await them before writing to the shared connection
(g15). COMMIT is wrapped in `Effect.uninterruptible` — the `use` step is not, and
an interrupt between the last query and the commit must not abandon an open
transaction on a pooled connection. A failed COMMIT or ROLLBACK destroys the
client instead of returning it (g17, g18); the release happens exactly once,
guarded by a flag, and never rejects.

**Two pools.** A session-level advisory lock lives on its connection, so the
application's lifetime lock cannot come out of the pool of 4 — it would be a
client that never returns, and a query-sized `statement_timeout` would kill the
lock wait. `maintenance` is `max: 1`, `idleTimeoutMillis: 0`, with its own longer
but still bounded statement timeout. The difference is in the **types**, not in a
comment: `createQueryRuntime` returns `PostgresQueries`, which has no
`maintenance` member, so `runtime.maintenance` on a query-only runtime is a
compile error instead of a session lock that silently dies when the idle reaper
closes the client it lived on. Both runtimes close through the same memoised,
redacting closer. Every timeout is a startup GUC, in force on
the first query without a `SET` round trip (g1).

**Error mapping, one place.** Class 23 in full (`23505`, `23514`, `23502`,
`23503`, `23P01`) plus the three class-22 type violations (`22P02`, `22003`,
`22001`) become `DomainConflict{persistence_conflict}` — the class-22 three
because STRICT SQLite answered `SQLITE_CONSTRAINT_DATATYPE` there and the host
turned it into a 409. `22007`/`22008` are absent: dates stay TEXT, nothing casts
a date. `save proforma conversion` and `save proforma invoice conversion` keep
`proforma_already_converted`. Anything else stays `PersistenceFailure`, i.e. a
500. Nothing from the driver's error travels into the mapped failure — no
message, no `cause` — because a `pg` connection error carries the configuration,
password included; `redactSecrets` exists for the one place that does surface a
message, the pool's `error` event.

**Query composition.** PostgreSQL numbers its parameters, so each fragment takes
the index its first placeholder must use and binds exactly that many values:
`nameKeyset(page, column, startIndex)`, `sourceFilter(source, startIndex,
prefix)`, `documentKeyset`, `draftKeyset`. `fragments(startIndex, builders)`
chains them, and the next free index is `startIndex + result.values.length` —
which is how `LIMIT` gets its number. An absent page or filter yields `{ sql: "",
values: [] }` and shifts nothing. The 46-column inserts are built from
`pairs(columns, values)` + `insertStatement`, which throws on a length mismatch
rather than silently shifting every column by one.

**`COLLATE NOCASE`.** `fold(x)` is
`translate(x,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') COLLATE "C"`
— the alphabet written out, because `translate` takes a character set and `'A-Z'`
would fold three characters. It is applied to **both operands** (SQLite compared
the bound value case-insensitively too) and is the same expression in the keyset,
in `ORDER BY` and in the `product_presets_organization` expression index;
`id COLLATE "C"` is the tie-break. ASCII only: `Ălpha` is not folded, exactly as
NOCASE behaved.

**Decoding.** TEXT arrives as a string, `integer` (int4) as a number, `bigint`
(int8) as a **string** — no global type parser is installed, so `epoch(row, field)`
decodes the two session epochs explicitly and throws rather than rounding past
2^53. Money and dates are TEXT on both engines and decode with `text`: the exact
characters the writer bound. Booleans are the 0/1 integers the CHECKs expect
(`booleanValue`). Branding stays TEXT with an `IS JSON` CHECK, parsed in
`brandingFrom`.

**`rowCount`, not `changes`.** Every `result.changes === 0` guard became
`rowCount === 0`: `saveDraft`, `saveCustomer`, `saveProductPreset`
(`ON CONFLICT … DO UPDATE … WHERE <table>.organization_id = excluded.organization_id`
matches nothing when the id belongs to another organization), `deleteDraft`,
`softDeleteCustomer` and `savePayment`. The list projections keep selecting
`issuer_branding` as NULL, so a list answer never parses a logo.

**Dialect fixes found while translating, not by search-and-replace:**
`findLatestIssueDate`'s derived table needed a name (`AS issued_or_corrected`);
`allocateDocumentNumber`'s `DO UPDATE SET last_number = last_number + 1` is
written qualified (`invoice_sequences.last_number + 1`); the register's union
types the `NULL` original number (`NULL::integer`). The allocation stays a
transactional UPSERT and not a sequence — a sequence would not roll back with the
issuance that reserved the number.

**Transactions are never nested.** Two logical keys live on one pool, and each
transaction checks out its own connection. A business transaction opened inside a
documents transaction (or the reverse) consumes two of the four connections per
request, and a path taking 3-then-2 against a path taking 2-then-3 deadlocks
until the statement timeout turns it into a 500. Compose them **sequentially**:
the 8 composition sites must not hold one while opening the other.

**`listCustomers` is deliberately unindexed for its ordering.** Catalog has the
matching expression index (`product_presets_organization`), customers has only
`customers_organization` and `customers_active_organization(organization_id,
deleted_at, legal_name)` with plain collation, so
`ORDER BY fold(legal_name), id COLLATE "C"` sorts the organization instead of
walking an index. That is the SQLite baseline's index set, and adding an index
here would be a schema change outside this unit's parity scope — recorded for the
schema owner, not fixed here.

**Artifacts.** Metadata is in PostgreSQL on the documents lock; the PDF stays
content-addressed on the filesystem. There is **no cross-store atomicity** and
none is claimed: the row is the index, an orphan object is inert, a row whose
object is missing is a read failure. `saveArtifact` stays idempotent — an
identical stored row is returned, a different one raises `ArtifactConflict` and
the transaction rolls back.

## 4 The test rig

`compose.pg-adapters.yaml` + `standalone/storage/postgres-rig.test-support.ts`.
A fourth rig, added rather than folded into the three that exist: the verifier,
the driver probe and the schema gate are untouched. `postgres:16-alpine` pinned
by digest, cluster on tmpfs, no published port, own compose project, `trust`
inside the rig only, `max_connections=64`. One fresh database per test file,
created with `TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C' ENCODING 'UTF8'`,
the name validated against `^[a-z][a-z0-9_]{0,48}$` before interpolation and
randomised so repeated runs in a surviving `db` container cannot collide.
`CREATE DATABASE` is serialised through a session advisory lock on the
maintenance connection. **No database is discarded at runtime and nothing
existing is reset:** the cluster dies with the container.

The pool is real and injected, and the schema is applied through the existing
`applyMigrations(pool)` — not a fixture, not a mock. The triggers, the CHECKs, the
folded index and the deferred FK cycle are the behaviour under test.

It is **not** part of `pnpm test`; it runs the three files by path.

```sh
scripts/verify-docker.sh install                                     # frozen
docker compose --file compose.pg-adapters.yaml run --rm adapters     # 20 tests
docker compose --file compose.pg-adapters.yaml down                  # no volume, no -v
```

### What the 20 tests prove

| Test | What it measures |
|---|---|
| ports round-trip | issuer + branding, series (and `document_series_exists`), customer, preset, draft + line, issuance, the summary projection without branding, payments + idempotent replay, proforma, conversion, `proforma_already_converted`, a draft-less proforma through the generated column and the deferred cycle, correction, register (both kinds), `listCorrections` |
| money | `"125.5"` normalises to `"125.50"` and `"1.25"` to `"1.2500"`, read back character for character from a TEXT column |
| folded keyset | five mixed-case names, `limit 2` → 3 rows; the second page's cursor is spelled in a **different case** than the stored row and still lands correctly; `Ălpha` sorts last, so the fold is ASCII only |
| error mapping | a real CHECK (`23514` on the translated money pattern), a real type violation (`22P02`), a real trigger (`audit_events_no_update`, `23514` from the shared foundation function) — each asserted as the SQLSTATE **and** as what `writeFailure` makes of it |
| artifacts | idempotent save, `ArtifactConflict` on a different artifact, the stored row unchanged after the rollback |
| commit | the row is visible, a connection is idle in the pool, 0 sessions `idle in transaction` |
| rollback | the write inside the failed transaction is gone, 0 sessions `idle in transaction` |
| interruption with a query in flight | the in-flight query settles **before** the rollback, 0 sessions `idle in transaction`, and the next transaction on the same pool succeeds |
| serialisation | four concurrent `allocateDocumentNumber` calls answer 1, 2, 3, 4 — no duplicate |
| close | `close()` twice does not fail; a transaction afterwards fails as `PersistenceFailure{begin transaction}` |
| failed statement | the operation name survives and the failure carries only `_tag` and `operation` — no driver message, no cause, so no password can travel with it |
| unmapped SQLSTATE | `42P01` stays a `PersistenceFailure` (a 500, not a 409); `redactSecrets` strips `password=` and a URL's userinfo |
| multi-statement interruption | a body that sends statement 1, is interrupted, then tries statement 2: the order is `statement-1 → interrupted → statement-2-refused:TransactionClosed`, **both** rows are absent (statement 1 rolled back, statement 2 never reached the server), 0 sessions `idle in transaction`, and the next transaction on the same pool commits normally. Without the guard the same test records `statement-2-accepted` |
| query-only runtime | `"maintenance" in runtime === false`, and `close()` twice does not fail |
| every composed keyset, on the engine | drafts, issued invoices, proformas and the register each paged with `after` AND a `source` filter, second page asserted — so the placeholder arithmetic (the register binds nineteen values across two halves) and the unqualified `issue_date`/`id` in `draftKeyset` are executed by PostgreSQL, not reasoned |

## 5 Verification

| Command | Log | Result |
|---|---|---|
| `scripts/verify-docker.sh run "pnpm typecheck && pnpm lint"` | `.local/t-1480/90-typecheck.log` | exit 0 |
| `scripts/verify-docker.sh run "pnpm lint && pnpm gate:size && pnpm gate:boundaries"` | `.local/t-1480/88-gates.log` | exit 0 — size gate passed (cap 6000 unchanged), boundary cruise `no dependency violations found (789 modules, 3555 dependencies cruised)` |
| `docker compose --file compose.pg-adapters.yaml run --rm adapters` ×2 on a fresh cluster | `.local/t-1480/91-adapters-final1.log`, `92-adapters-final2.log` | **20/20 pass, 0 fail**, exit 0 both times (pre-review) |
| the same, after the review fixes, ×2 | `.local/t-1480/98-paging2.log`, `101-fix-run2.log` | **23/23 pass, 0 fail**, exit 0 both times |
| the guard removed on purpose, runtime file only | `.local/t-1480/96-guard-removed.log` | 8 pass / **1 fail** — `statement-2-accepted`, the leak reproduced |
| the same suite without a database | `.local/t-1480/94-no-pg.log` | 10 pass / 10 fail, `getaddrinfo EAI_AGAIN db` — the expected shape |

### Defects found by running it, not by reading it

1. `'1.2500' !== '1.25'` — the expectation was wrong, not the adapter: the domain
   normalises a quantity to four decimals and the TEXT column returns exactly
   that. Recorded as the money assertion.
2. `DomainConflict: Conflict while performing save customer` in the keyset
   fixture — `customers_bucharest_sector` requires a sector for `RO-B`. The
   fixture moved to `RO-CJ`; the mapping was right.
3. The interruption test first observed `[]` instead of `['query','settled']`:
   `Effect.runPromise(Effect.fork(…))` lets the root fiber finish, which
   interrupts the child immediately — the interrupt landed in the acquire, not in
   the query. The fork, the wait and the interrupt now live in one program.
4. `database "t_ports_14_1" already exists` on the second run: `run --rm` removes
   the test container and leaves `db` up, so a pid-derived name collides. Names
   are random now.
5. The fifth consecutive run in the same `db` container crashed the postmaster
   into recovery (`57P03`): each run adds one database per test file and 512m of
   tmpfs ran out. The rig is 1g and the accumulation is written down in the file.
6. `eslint` rejected `${number}` in template literals
   (`restrict-template-expressions`) across every file that numbers a
   placeholder; all are `${String(n)}` now.

### What is still red, on purpose

`pnpm test` is **not** green and was not made green. The legacy SQLite suite is
still 175 failing tests across 32 files from the schema step, and the two new
database-backed files add to that count when run without a server — they need the
PostgreSQL service the integration step will give the verifier. Nothing legacy
was skipped, disabled or modified, and no frozen fixture in `standalone/parity/`
was touched or re-captured.

`pnpm verify` therefore still fails at `pnpm test`; the gates that do not depend
on it (lint, typecheck, size, boundaries) are green.

The hub's architecture report could not run: `architecture-report run
--project=invoicing-qwbe --diff` stops with `Analyzer native-boundaries runs the
project's own probe as a child process; pass --allow-native to authorize this
invocation`, which this unit was not authorized to pass. The project's own probe
is the one that did run, green, as `pnpm gate:boundaries`.
