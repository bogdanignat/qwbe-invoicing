# T-1480 unit INTEGRATION — the application, HTTP and the CLI on PostgreSQL

Branch `feat/T-1480-postgresql`, HEAD `b3ebd4c` (no commit, no push). Every
execution was in Docker. Captured 2026-10-01. **This unit is a checkpoint, not a
finished switch.** Round 1 wired the runtime; round 2 answered all 13 review
findings, removed the dead `sqlite-*` cluster and proved the new lifecycle code on
a real PostgreSQL 16 server (14/14). What is still missing — prod/preview compose,
the `pg` boundary rule, the contract and FOUNDATION/PRODUCT/LOCAL_DEVELOPMENT
updates, the image build and the boot smoke — is enumerated at the end, with no
claim of green anywhere there is none.

## 1 What now runs on PostgreSQL

No dual engine exists and no flag chooses one. The application has exactly one
storage backend: the pool.

| Site | Before | Now |
|---|---|---|
| `standalone/config.ts` | `RuntimeConfig` without a database | `pgSettings: PostgresSettings`, password read from `PGPASSWORD_FILE` |
| `standalone/storage/migrations.ts` | `node:sqlite`, three files, WAL | facade over `postgres-migrations.ts` + the global fingerprint, every entry point async |
| `standalone/api/api-services.ts` | `createSqliteStore(dataDirectory)` | `createPostgresStore(runtime.pool)` / `createPostgresPaymentsStore(runtime.pool)` |
| `standalone/documents/artifact-runtime.ts` | `createArtifactRepository(dataDirectory)` | `createPostgresArtifactRepository(pool)` + `createPostgresInvoiceSource(pool)`; `dataDirectory` is the PDF object store only |
| `standalone/auth/browser-session.ts` | `DatabaseSync` per call | `browser-session-store.ts` on the pool; `login/resume/authorize/revoke` are `Promise`-returning |
| `standalone/http/readiness.ts` | sync cache | async, single-flight, fail-closed, stale-within-interval |
| `standalone/http/http.ts` | `startServer(config, …)` | `startServer(config, pool, …)`, `applicationReady(config, pool, barrierHeld)` |
| `bin/qwbe-invoicing.ts` | sync commands on a directory | a pool per command, `finally close()`, `serve` holds the SHARED barrier |

## 2 The API this unit consumes and the API it adds

Consumed, unchanged: `createPostgresRuntime` / `createQueryRuntime` /
`PostgresSettings` (`postgres-pool.ts`), `createPostgresStore`,
`createPostgresPaymentsStore`, `createPostgresArtifactRepository`,
`createPostgresInvoiceSource`, `applyMigrations`, `planMigrations`,
`applyMigrationsOnClient`, `assertCollationC`, the maintenance lock helpers, and
the ops contract `BackupContext{pool,settings,dataDirectory}` with
`executeBackup`/`executeRestore`/`planBackup`/`planRestore` from
`standalone/ops/postgres-backup.ts` (owned by the ops unit, consumed here).

Added:

```ts
// standalone/storage/postgres-schema-fingerprint.ts
const appliedOrder:   (executor: SqlExecutor) => Promise<ReadonlyArray<string>>
const replayFingerprint: (client: PoolClient, keys: ReadonlyArray<string>) => Promise<SchemaObjects>
const schemaDriftOnClient: (client: PoolClient) => Promise<ReadonlyArray<string>>
const schemaDrift:    (pool: Pool) => Promise<ReadonlyArray<string>>
const resetFingerprintCache: () => void
// standalone/storage/postgres-schema-introspection.ts
const introspectSchema: (executor: SqlExecutor, schema: string) => Promise<SchemaObjects>
// standalone/storage/postgres-maintenance-session.ts
const startMaintenanceSession: (pool: Pool, options?) => Promise<MaintenanceSession>
//   MaintenanceSession = { held: () => boolean; release: () => Promise<void> }
// standalone/storage/migrations.ts
const databaseReady: (pool: Pool) => Promise<boolean>
const artifactsDirectoryReady: (dataDirectory: string) => boolean
// standalone/http/http.ts
const applicationReady: (config, pool, barrierHeld?) => () => Promise<boolean>
// standalone/ops/cli-doctor.ts
const doctorReport: (config: RuntimeConfig, pool: Pool) => Promise<DoctorReport>
```

## 3 The decisions a reader has to know

**Drift is a replay, not a checksum.** `schemaDrift` reads the ledger, replays
exactly the migrations it names into a scratch schema and compares the result
with live `public` through the same introspection. One transaction,
`SET LOCAL search_path = <scratch>, pg_catalog` — **without `public`**, so a
statement that depends on a foundation function finds the one the replay just
created or fails, instead of silently resolving to a live object and hiding the
drift — and `ROLLBACK` in a `finally`, always. Every function that opens that
transaction takes a `PoolClient`, never a `Pool`: `pool.query("BEGIN")` would
begin on whichever connection is free and the scratch schema would escape the
transaction. Compared: tables, columns (type/nullability/default/generation),
constraints by deterministic name, indexes, triggers and function bodies. Not
compared: OIDs, the schema name (erased on both sides) and the ledger itself,
which the replay never creates.

**Boot never blocks and never migrates.** `serve` builds the two-pool runtime,
takes the maintenance barrier SHARED on the dedicated connection with a bounded
try (20 × 250ms), and listens either way. `/health/live` stays 200;
`/health/ready` and every `/api*` route answer 503 while the barrier is not
held, the artifact directory is not writable or the schema does not match the
ledger. The keepalive asks `pg_locks` whether THIS backend still holds the lock,
so a reset connection or a manual unlock closes the gate on evidence rather than
on hope. Shutdown order is drain → release barrier → end pools: releasing first
would let a maintenance command start with writes still in flight.

**Ownership of the pool is in the call sites.** Every non-`serve` command ends
its pool in a `finally`, `serve` does not — its pools die with the signal
handler. `api.dispose` is memoised and drains the HTTP handler only; it never
ends the pool, because the CLI and the server disagree about when that should
happen.

**The password never leaves the file.** `PGPASSWORD_FILE` is read with
`readFileSync(path,"utf8").trim()`, exactly as `AUTH_TOKEN_FILE` is, and only
the pool sees the value. `PGPASSWORD` is never set, so no child process and no
`docker inspect` can see it; `doctor` reports host/port/database/user and not the
secret; pool errors are reported through `redactSecrets`.

**Session writes take both locks, in the only safe order:** the SHARED
maintenance barrier first, then `pg_advisory_xact_lock` on the sessions key
(1480,4). Both are transaction-scoped. `BIGINT` epochs arrive as strings and are
decoded with `Number.isSafeInteger`, so an out-of-range value is refused instead
of rounded.

**`api.ts` was split, not shrunk by deletion.** The invoicing route table moved
to `api-invoicing-group.ts`; the composition root keeps the documents group, the
layers and the handler. The 6000-character cap is measured, not assumed: the
size gate passes.

## 4 Verification actually run

| What | Command | Result |
|---|---|---|
| lint, 19 touched files | `scripts/verify-docker.sh run "npx eslint …"` | clean (after fixing the two errors the split introduced) |
| typecheck | `scripts/verify-docker.sh run "npx tsc -p tsconfig.json"` | first round 270 errors; after the fix round **2**, both in the ops unit's own `postgres-backup.test.ts` |
| size gate | `node probes/size-gate.mjs` | passed, cap 6000 unchanged |
| dev compose | `docker compose --file compose.yaml config --quiet` | valid |
| PG client pin | `apk add --no-cache --simulate postgresql16-client` in the pinned base | `postgresql16-client (16.15-r0)` |

First round: 266 of the 270 were legacy `*.test.ts` files still calling the
synchronous SQLite API, 3 were the dead `sqlite-*` modules and 1 belonged to the
ops unit. After the fix round the tests are ported (by the tests unit), the dead
`sqlite-*` cluster is deleted, and the only two remaining errors are in
`standalone/ops/postgres-backup.test.ts`, which the ops unit owns.

## 5 Review fix round

The full finding-by-finding answer, the commands and the remaining gaps are in
`/tmp/T-1480-integration-fix-report.md` and summarised here.

## 1 Findings, one by one

| # | Sev | Where | Done |
|---|---|---|---|
| 1 | high | `config.ts` secret not fail-closed | `secretFrom(path, nodeEnvironment)`: outside `development`/`test` a missing file throws `PGPASSWORD_FILE is required outside development`, an empty file throws `PGPASSWORD_FILE is empty: <path>`. Empty password survives only in dev/test (`trust` rigs). Test: `standalone/http/postgres-readiness.test.ts` |
| 2 | high | `/health/live` waited on the database | `needsReadiness(url)` in `http-request-listener.ts`: only `/health/ready` evaluates readiness; `/health/live`, `/`, 404 and 405 answer with no DB call. Test: "liveness never depends on readiness" |
| 3 | high | boot died with the database | `startMaintenanceSession` no longer rejects (acquire failures are caught internally, the candidate client is destroyed), and `bin` additionally `.catch`es it into an unheld session. HTTP listens regardless |
| 4 | high | lost barrier was terminal | rewritten: `held()` flips false at once, the client is destroyed (`release(error)`) so the `max: 1` pool keeps its slot, and a bounded-backoff worker (250ms → 5000ms cap) re-acquires forever. Verified live with `pg_terminate_backend` |
| 5 | high | `resume` on `GET /api` outside try/catch | that branch now wraps readiness + `resume` + docs render in one try/catch (500 + `logInternalFailure`), the `/api/*` branch keeps its own, and the dispatch IIFE has an outer `.catch`. **No `process.on("unhandledRejection")` was added** — it would hide this class of bug instead of surfacing it |
| 6 | medium | exclusive lock on session reads | **invalid by decision** — see §2 |
| 7 | medium | dirty connection returned after a failed ROLLBACK | `ScratchNotRolledBack` (`postgres-schema-replay.ts`) is thrown when the second ROLLBACK also fails; `schemaDrift` and `doctorReport` both `client.release(error)` on it, so a dirty connection is never pooled |
| 8 | medium | DDL privilege for runtime readiness | **approved plan decision** (owner role + scratch schema) kept; the real gap — no diagnostic — is fixed: `applicationReady` takes a `report` callback emitting codes `maintenance_barrier_not_held` / `artifact_directory_not_writable` / `schema_pending_or_drifted` / `schema_check_failed:<Error.name>`, and `serve` logs them with the barrier state. Codes and `Error.name` only, never a driver message |
| 9 | medium | raw `error.message` in the CLI catch | `standalone/ops/cli-redaction.ts`: `cliRedactor(secret)` = pattern redactor + the literal secret, `failureMessage` walks a bounded cause chain (3 links). Used for the final catch, the barrier catch and pool errors. Tests: `standalone/ops/postgres-cli-redaction.test.ts` |
| 10 | low | readiness comment contradicted the code | a failed run is now genuinely not cached (fail-closed `false`, next call retries), the value+timestamp are recorded inside the same continuation and `inFlight` is cleared after, so the single-flight window is closed. Tests: 3 cases |
| 11 | low | `planRestore` called twice in dry-run | one scan, both `scanned` and `files` derived from it |
| 12 | info | `barrierHeld` defaulted to `true` | the parameter is now required; `startServer`'s own default passes `() => true` explicitly |
| 13 | info | `doctor` did the work 2–3× | one checkout, one pass: `planMigrations` + `ledgerReady` + `schemaDriftOnClient` on the same client, `ready` derived from those values |

## 2 The two findings answered instead of applied

**Finding 6 — exclusive lock on the session read path.** Not changed. SQLite's
`BEGIN IMMEDIATE` had no read-only fast path, so every transaction serialised on
the writer lock; introducing a shared mode here is a behaviour change on the
authentication path, where a reader observing a half-applied expiry sweep is the
hazard the lock exists for. The approved plan states it explicitly ("lock logic
EXCLUSIV pe TOATE tranzacțiile"). The legitimate half of the finding — that the
cost was asserted and not measured — is recorded as an open item, and the comment
in `browser-session-store.ts` no longer claims a test that does not exist.

**Finding 8 — least privilege for the runtime role.** Not changed. The
application role owns the schema it migrates; the scratch replay is the only way
to answer "is the live schema the one the ledger describes" without trusting a
stored checksum, which the plan rejected. What was genuinely missing was the
diagnostic, and that is now there (§1 row 8).

## 3 Also finished in this round

- **Dead SQLite production cluster removed**: 25 `standalone/storage/sqlite-*.ts`
  files deleted after an import scan proved no live caller
  (`grep -rl` over `standalone bin cube probes web frontend`; the only hits are
  two comment references in `frontend/src/lib/api-errors.ts:69-70`, no imports).
  No compatibility shim was left behind.
- **`api.ts` / listener splits** to stay inside the 6000-character cap:
  `standalone/api/api-invoicing-group.ts`, `standalone/http/http-api-forward.ts`,
  `standalone/storage/postgres-schema-replay.ts`.

## 4 Commands, exit codes, evidence

```
docker compose --file compose.pg-adapters.yaml run --rm adapters \
  node --test standalone/http/postgres-readiness.test.ts \
             standalone/ops/postgres-cli-redaction.test.ts \
             standalone/storage/postgres-maintenance.test.ts
→ tests 14, pass 14, fail 0, duration_ms 1822.8   (real PostgreSQL 16, exit 0)

scripts/verify-docker.sh run "npx eslint standalone bin"      → clean, exit 0
scripts/verify-docker.sh run "npx tsc -p tsconfig.json"       → 2 errors, BOTH in
  standalone/ops/postgres-backup.test.ts (300,24) and (458,21) — the ops unit's
  own in-flight file. 0 errors in any file this unit owns (was 270 last round).
scripts/verify-docker.sh run "node probes/{size,package,test,boundary}-gate.mjs"
  → size gate passed; package-shape gate passed; unit-test gate passed;
    dependency-cruiser: no violations (786 modules, 3486 dependencies), exit 0
```

Logs: `.local/t-1480/integration-fix-verify{,2,3,4}.log`,
`integration-fix-typecheck.log`, `integration-fix-gates.log`.

The six new real-server assertions that did not exist before this round: barrier
held + exclusive taker refused; release idempotent; `pg_terminate_backend` → lost
→ re-acquired; clean drift on a fresh database with no surviving `qwbe_drift_*`
schema; an edited `qwbe_abort` body reported as `function:qwbe_abort(...)` drift;
introspection excludes the ledger and sees triggers and constraints.

## 5 NOT done — the honest remainder

1. `compose.prod.yaml` / `compose.preview.yaml`: no `db` service, no PG env, no
   `pg_password` secret, no `--locale=C` init, no separate preview volume.
   `compose.yaml` (dev) is wired and `config --quiet` is valid.
2. The `pg` boundary rule is **not** written: `dependency-cruiser.config.cjs`,
   `architecture/contract.json` and the `probes/boundary-gate.test.mjs` fixture
   are untouched. The gate passes today only because no cube imports `pg`.
3. `architecture/contract.json` decision line for foundation-owned functions, and
   `FOUNDATION.md` / `PRODUCT.md` / `docs/LOCAL_DEVELOPMENT.md` updates: not done.
4. No real `docker build` of the shipped image, so `postgresql16-client=16.15-r0`
   is still only `--simulate`-verified; no boot smoke on any compose file.
5. Backup staging volume (`/var/backups/staging`, explicit `TMPDIR`, bounded
   tmpfs) not added to any compose file.
6. Regression tests still owed: saturation liveness, `/api` docs-resume rejection
   → 500 without crash, session-read contention under a concurrent writer, and the
   CLI smoke (`doctor`/`migrate`/reapply/`help` exit codes + pool shutdown).
7. `pnpm verify` end to end was not run this round (the tests worker owns the
   harness and the suite); only lint, typecheck and the four static gates were.
