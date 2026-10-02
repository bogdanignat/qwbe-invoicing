# T-1480 — the test suite on PostgreSQL 16

How the suite runs now, what each ported file asserts against a real server, and
what is still open. Companion of `docs/T-1480-{schema,adapters,integration,ops}.md`.

## There is no host run any more

Every storage, API, HTTP, auth, e-Factura, documents, ops and frontend-proxy test
talks to a live PostgreSQL 16 cluster, so `node --test` on the host means nothing.
The suite runs in its own rig:

    scripts/verify-docker.sh test                                   # pnpm test
    scripts/verify-docker.sh test "node --test standalone/storage/pagination.test.ts"
    scripts/verify-docker.sh verify                                 # pnpm verify
    docker compose --file compose.test.yaml down                    # never -v

`compose.test.yaml` is permanent — the five `compose.pg-*.yaml` files each carried
one unit while it was being built, this one carries the suite. Its cluster is on
tmpfs (6g), publishes no port, references no application volume, and the four
dependency volumes are the verifier project's, owned by the host UID through
`Dockerfile.verify`'s `HOST_UID`/`HOST_GID`. `test-init` writes the rig password to
`/run/qwbe-test/pgpassword`, mode 0600, host UID — a file because the shipped
runtime only ever reads `PGPASSWORD_FILE`, so the ported CLI tests exercise the
production path. `PGPASSWORD` is set in the environment for
`standalone/ops/postgres-backup.test.ts` alone and the fixture's `childEnv()`
strips it before spawning anything.

`package.json` runs `node --test --test-concurrency=4 --test-timeout=120000`. The
timeout is a bound, not a policy change: `node:test` defaults to no timeout at
all, so one DB-backed case waiting on a lock stalls the whole suite with no
failing assertion — already observed at 639 s per file. 120 s is far above the
slowest legitimate case (the longest integration cases declare their own
`timeout: 60_000`), so nothing long is cut short. The server is started with
`max_connections=64`: per file an application pool of 4, a raw-SQL pool of 2, a
maintenance connection and a short-lived creation connection — 8, so ~32 for four
files, plus the `pg_dump`/`psql` children of the ops suites.

## The harness: `standalone/storage/postgres-rig.test-support.ts`

One module, no mock, no SQLite compatibility layer, no SQL translation. It gives:

- `fixture(label)` — a database per test file, and per case where a case needs an
  empty or differently migrated cluster. Name from the label, validated against
  `/^[a-z][a-z0-9_]*$/`, created `TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'
  ENCODING 'UTF8'` from the maintenance database, serialised by
  `pg_advisory_lock(1480, 9001)`.
- `fixture.close()` — closes SQL and runtime, removes the artifact tree, then
  reclaims the database with `WITH (FORCE)` under the same lock. This is what keeps
  the tmpfs cluster bounded: ~90 databases are created per full run and the cluster
  ends at 181.9M / 3 % instead of filling 3g and answering `could not write init
  file` for the rest of the run.
- `sql` — a test-only pgPool query helper: `query`, `scalar`, `rows`, `exec`,
  `withoutTriggers`, `transaction`. Async everywhere; no `DatabaseSync`.
- `childEnv()` — PG configuration for spawned `bin/qwbe-invoicing.ts` children,
  with the secret path readable by the container UID and `PGPASSWORD` removed.
- Direct `PostgresSettings` objects where a case needs them, so the production
  fail-closed secret guard stays untouched.

Startup, API handler and sessions are async: every caller `await`s close/dispose.

## Ported files, green individually in the rig

| file | tests |
|---|---|
| standalone/storage/postgres-adapter-surface.test.ts | 2 |
| standalone/storage/vat-treatment-storage.test.ts | 1 |
| standalone/storage/pagination.test.ts | 1 |
| standalone/storage/invoice-register-pagination.test.ts | 1 |
| standalone/storage/issuer-storage-validation.test.ts | 1 |
| standalone/storage/issuer-vat-storage.test.ts | 1 |
| standalone/storage/proforma-storage.test.ts | 2 |
| standalone/storage/draft-atomicity.test.ts | 3 |
| standalone/storage/proforma-atomicity.test.ts | 4 |
| standalone/storage/postgres-catalog.test.ts | 4 |
| standalone/storage/postgres-store.test.ts | 4 |
| standalone/storage/schema-baseline.test.ts | 6 |
| standalone/storage/schema-drift.test.ts | 7 |
| standalone/auth/browser-session.test.ts | 1 |
| standalone/documents/artifacts.test.ts | 2 |
| standalone/efactura/efactura-issuance.test.ts | 9 |
| standalone/http/readiness.test.ts | 1 |
| standalone/http/http-session.test.ts | 1 |
| standalone/http/http-builder.test.ts | 3 |
| standalone/http/http-input-validation.test.ts | 40 |
| standalone/http/http-login-throttle.test.ts | 12 |
| standalone/http/product-vat-preference-http.test.ts | 3 |
| standalone/http/vat-treatment-http.test.ts | 3 |
| standalone/api/{api,draft-idempotency-http,invoice-register-api,proforma-api}.test.ts | 24 |
| standalone/ops/standalone.test.ts | 11 |
| probes/frontend-proxy-{http,integration}.test.mjs | 5 |

## How SQLite assertions became PostgreSQL assertions

- Raw `DatabaseSync` statements became `await sql.*`; fixture SQL `?` became `$N`;
  DML in transactions is awaited.
- `assert.throws` on a negative insert became `await assert.rejects` matching a
  SQLSTATE: `23514` CHECK or trigger `RAISE`, `23503` FK, `23505` unique, `23502`
  NOT NULL, `22P02` invalid input syntax, `42P01`/`42703` missing object.
- Error-shape tests assert HTTP 409 plus SQLSTATE class 23/22 instead of SQLite
  message phrases.
- `PRAGMA foreign_keys=OFF` became `session_replication_role = replica`;
  `PRAGMA ignore_check_constraints` became `ALTER TABLE … DISABLE TRIGGER USER`
  plus dropping the named CHECK, which is why the invalid-data round trip now also
  asserts the CHECK catalogue by name.
- `count(*)` arrives as bigint text: decoded with `Number()`, including the session
  expiry, which is asserted as a real number.
- Row identity: `to_jsonb(t) ORDER BY to_jsonb(t)::text` replaces `rowid` ordering.
- Definitions are read from the catalogue — `pg_get_constraintdef`,
  `pg_get_triggerdef`, `pg_indexes.indexdef`, `information_schema` nullability,
  generated columns — instead of comparing `sqlite_master` SQL text. GLOB/NOCASE
  parity is the folded expression index compared against the golden.
- `schema-baseline` walks ownership composed over `migrationScopes` and keeps a
  standalone explicit negative for the wrong owner; `schema-drift` compares the
  real catalogue and function bodies through `introspectSchema` plus the replayed
  ledger.
- Concurrency, idempotency, storno and payments invariants are unchanged.

Test counts moved only where a SQLite premise was impossible: the FK-parent
meta-test, the per-cube in-memory baselines, `journal_mode`/WAL, the unwritable
database file, `STRICT` tables, the `DATA_DIR` CLI failure, and the forged
`invoice_series` column (which no schema ever had — the legacy `assert.throws`
passed for the wrong reason). Nothing was skipped, deleted, stubbed or weakened.
`standalone/parity/sqlite-*.json` goldens are untouched.

## State of the gates

Written from the runs on this tree, not from an earlier one.

Verified in this round (`scripts/verify-docker.sh test`, stdout to a file, real
exit code captured):

- The whole suite, after the runtime unit's history fix landed: **1194 tests,
  1194 pass, 0 fail**, `PNPM_TEST_EXIT=0` (`/tmp/T-1480-final-fix.log`). That
  includes `schema-drift.test.ts`, which the per-scope gap rule in
  `postgres-schema-fingerprint.ts` resolved.
- `pnpm lint` → `LINT=0` and `pnpm typecheck` → `TYPECHECK=0` on this tree
  (`/tmp/T-1480-final-fix2.log`).

- `probes/frontend-container-contract.test.mjs`,
  `standalone/storage/postgres-rig.test.ts`,
  `standalone/storage/postgres-maintenance.test.ts` → **10 tests, 10 pass**,
  exit 0 (`/tmp/T-1480-fix1.log`).
- Stability of the concurrency path that was red: three consecutive runs of
  `postgres-maintenance`, `postgres-runtime`, `postgres-rig` and
  `schema-baseline` together at `--test-concurrency=4` → **23 pass, 0 fail,
  exit 0** each time (`/tmp/T-1480-subset.log`, `SUBSET_EXIT_{1,2,3}=0`).

What was red in `/tmp/T-1480-final-verify.log` (**1190 tests, 1187 pass, 3 fail**,
`FINAL_VERIFY_EXIT=1`) and what happened to it:

| failing case | owner | state |
|---|---|---|
| `probes/frontend-container-contract.test.mjs` "preview is opt-in …", `4 !== 3` | this unit | fixed: the fixture no longer counts profile occurrences, it asserts the roster `[db, migrate-fixture, backend-fixture, frontend]`, that each service carries `profiles: [preview]`, and that the new `db` has the preview secret, the preview volume and no published port |
| `standalone/storage/postgres-runtime.test.ts` `Connection terminated unexpectedly` | this unit (the kill fixture) | fixed: see the advisory-lock note below |
| `standalone/storage/schema-drift.test.ts:223` `['missing:documents/documents-001-baseline']` | runtime unit | not edited here; green in the 1194/1194 run after the runtime unit made gap detection per scope |

Verified in the resume round of 2026-10-01 (every command through
`scripts/verify-docker.sh`, `LOG=` to a durable file under `.local/t-1480`, real exit
code echoed and recorded in each log's `=== exit code:` line):

| what ran | result | log |
|---|---|---|
| `node --test standalone/storage/postgres-maintenance.test.ts` | 6 tests, 6 pass | `.local/t-1480/300-maintenance.log`, exit 0 |
| `pnpm build:frontend` (verify rig) | Next 16.3.5 build + `prepare-standalone` | `.local/t-1480/301-build-frontend.log`, exit 0 |
| `pnpm test:frontend:runtime` (test rig) | 8 tests, 8 pass | `.local/t-1480/302-frontend-runtime.log`, exit 0 |
| `postgres-cli-lifecycle` + `postgres-serve-lifecycle` | 5 tests, 5 pass | `.local/t-1480/304-lifecycle.log`, exit 0 |
| `pnpm lint && pnpm typecheck` | both clean | `.local/t-1480/305-lint-typecheck.log`, exit 0 |
| `pnpm gate:size` | "Size gate passed." | `.local/t-1480/306-size-gate.log`, exit 0 |
| `postgres-maintenance` + `postgres-runtime` + `postgres-rig` + `schema-baseline` at `--test-concurrency=4` | 23 tests, 23 pass | `.local/t-1480/307-concurrency-subset.log`, exit 0 |
| `pnpm gate:boundaries` | "no dependency violations found (791 modules, 3527 dependencies cruised)" | `.local/t-1480/308-boundaries.log`, exit 0 |

`probes/frontend-runtime-fixture.mjs` is what made `test:frontend:runtime` reachable:
`startBackendFixture` was still calling `startServer(config, () => true)` and
`applyMigrations(directory)`, the SQLite signatures. It now takes a
`migratedFixture("frontend_runtime")` from the rig, hands `startServer` the fixture
pool positionally, passes an async `isReady`, and closes the server before the
fixture — so the token file lives in the fixture's `DATA_DIR` and the database is
given back on close.

Still unverified on this tree: `gate:runtime`, `gate:package`, `gate:test` and one full
`pnpm verify` end to end. `pnpm test` was not rerun in
full in this round either — the 1194/1194 figure above is from the earlier run on the
same tree, before the README/`cli.ts` help edits, which touch no runtime code. The
earlier "all gates pass" claim was about an earlier tree and does not stand here.

The "tmpfs ended at 181.9M / 3 %" figure was a `df` reading taken by hand and is
not in any log on disk; treat it as unverified.

The `/tmp/T-1480-*.log` files named above are from the pre-restart rounds and may no
longer exist; the durable logs are the `.local/t-1480` ones.

## Two bounds the harness was missing

**Every rig pool now goes through `createQueryPool`.** `PostgresSettings` is
camelCase, `pg`'s `PoolConfig` is not: the creation pool, the reclaim pool and the
raw-SQL pool used to be built as `new Pool({ ...settings(database), max: n })`, so
`statementTimeoutMillis`, `lockTimeoutMillis` and `idleTransactionTimeoutMillis`
were silently dropped and those connections ran with `statement_timeout = 0`. The
statements they run are exactly the ones that wait: `pg_advisory_lock(1480, 9001)`,
the reclaim behind a live connection, and `ALTER TABLE … DISABLE TRIGGER USER`
(ACCESS EXCLUSIVE). Unbounded, the file hung instead of failing.
`standalone/storage/postgres-rig.test.ts` reads the bounds back from the server for
all three pools — application 4000/3000/8000 ms, raw SQL 30000/15000, maintenance
60000/60000, each `connectionTimeoutMillis > 0` — and proves the bound bites: a
lock wait past `lock_timeout` comes back as `55P03`.

**`fixture.close()` is bounded.** `pool.end()` never resolves while a case holds a
checked-out client, and that wait sits in a `finally`. Each close now races a 10 s
deadline, prints which database leaked, and carries on to the forced reclaim, which
disconnects whatever was still attached.

## The camelCase audit, repo-wide

Searched for every `new Pool(` and `new Client(` outside `node_modules` and
`frontend/.next`. Four remain and none of them is handed a `PostgresSettings`:
`standalone/storage/postgres-pool.ts:84` and `:97` are the production builders
themselves, and `probes/pg-driver-probe.mjs:39` plus
`probes/pg-schema-gate.mjs:60`/`:138` build their config with `pg`'s own names
(`max`, `connectionTimeoutMillis`, `statement_timeout`), so nothing is dropped. Every
camelCase bound in the suite (`standalone/storage/postgres-rig.test-support.ts`,
`standalone/storage/postgres-maintenance.test.ts`,
`standalone/http/postgres-serve-lifecycle.test.ts`,
`standalone/ops/postgres-backup.test.ts`) reaches a pool only through
`createQueryPool`.

One cast is worth naming: `standalone/storage/postgres-history-drift.test.ts:35`
builds `pgSettings` as `{ ...runtime.pool.options, password: "" } as
RuntimeConfig["pgSettings"]`. It opens no pool — `doctorReport` reads host, port,
database and user from it for the report and queries through the rig pool it is given
— so no bound is lost, but the `as` would hide it if that ever changed.

`pg_locks` is read in two places only. The keepalive in
`postgres-maintenance-session.ts:62` filters by `pid = pg_backend_pid()`, which is one
backend in one database by construction, and the kill fixture filters by the lock's
own database plus `pg_stat_activity.datname`. Neither reads the cluster unfiltered.

## Advisory locks are per database; the kill was not

`pg_advisory_lock` keys are scoped to a database, so the per-file database really
does isolate the barrier. `pg_locks`, however, lists the whole cluster, and the old
kill fixture terminated by key alone — under `--test-concurrency=4` that reached
another file's session, which is how `postgres-runtime.test.ts` died while passing
alone. No key namespacing was needed, only the correct identity:
`standalone/storage/postgres-maintenance.test.ts` now selects
`classid`/`objid` plus `objsubid = 2` (the two-key advisory form) plus
`l.database = current_database()`'s oid, joined to `pg_stat_activity`, asserts
exactly one holder, terminates that one pid — and keeps a peer that holds the same
key in the maintenance database connected, asserting afterwards that its backend
pid is unchanged. The filter is therefore proved, not declared.

## Dead SQLite modules

Done: the 25 `standalone/storage/sqlite-*.ts` files no longer exist — the import
scan found no importer outside that set, and the integrator deleted them. The only
remaining mentions are two comments (`frontend/src/lib/api-errors.ts:69-70`,
`frontend/src/lib/api-errors.test.ts:66`) and two in prose
(`standalone/storage/schema-drift.test.ts:20`,
`postgres-rig.test-support.ts:22`). No test imports anything SQLite.

## History semantics moved to the runtime unit

The drift report now answers `history:missing:<scope>/<name>` and
`history:not_replayable:<sqlstate>` for a ledger whose history cannot be rebuilt
(`standalone/storage/postgres-schema-fingerprint.ts`, runtime unit). The ported
`schema-drift.test.ts` still reads the one-segment prefix at line 55 and fails at
line 223 for that reason. The file was left untouched here on purpose: the
semantics and that test are the runtime unit's, and adapting the expectation from
this side would mean guessing which of the two is the contract.

## The runtime review's findings, fixed with tests (2026-10-01)

Five findings from the runtime/lifecycle/test-delivery review
(`.local/t-1480/resume-runtime-review.md`): three medium, two low. Each one has a
test that is red on the old code and green on the new, or a run that shows the
behaviour directly. Nothing below was validated by a full `pnpm verify`: the last
full gate, `.local/t-1480/311-full-verify.log` (**tests 1196 / pass 1196 / fail 0**,
frontend-runtime 8/8, `311-full-verify.exit` = 0), ran on the tree **before** these
fixes and says nothing about them.

**Readiness destroys a connection whose rollback failed.**
`standalone/storage/migrations.ts:56-66` now mirrors `schemaDrift` and
`doctorReport`: `ScratchNotRolledBack` is caught, recorded and the client is
released *with* it, so `pg` drops the connection instead of recycling one whose
transaction state is unknown. The regression lives in
`standalone/storage/postgres-history-drift.test.ts` ("readiness destroys the
connection when the drift replay could not be rolled back"): a real `freshRuntime`
pool, a real replay, and the single injected failure is a `ROLLBACK` that never
comes back, with the session left alive — the shape a `statement_timeout` on the
rollback produces. It asserts the release argument is the error, and then reads the
consequence off the server: the replay's `qwbe_drift_*` scratch schema only exists
inside the transaction that was never rolled back, so a recycled client (the pool's
only connection) would see its own uncommitted schema, and a destroyed one cannot.

**SIGTERM is bounded and attempts every step.** The promise chain in
`bin/qwbe-invoicing.ts` skipped `barrier.release()` and `runtime.close()` whenever
the drain rejected, and its deadline only called `closeAllConnections()` — the
maintenance pool keeps a client checked out with `idleTimeoutMillis: 0`, so the
loop never drains and the container waited for Docker's SIGKILL (137). The sequence
moved to `standalone/http/shutdown.ts` (`runShutdown`), which keeps the order
(drain → queries → barrier → pools), destroys the remaining sockets when the drain
rejects or is still running at `escalateMs` before giving up the barrier, attempts every step even after a failure,
answers 1 if anything failed, and calls `abandon` — `process.exit(1)` in
production, from an `unref`'d timer — at the deadline. It is a parameter per step,
so `standalone/http/shutdown.test.ts` drives a rejecting drain, a rejecting
release, a rejecting pool close and a drain that never settles without an
environment variable or a test-only branch in production code.

T-1510 closed the gap the final review found: a drain that *hangs* (a client that
never finishes its body) was never escalated and sat idle until the 10 s deadline
abandoned the process. `runShutdown` now takes `escalateMs` (5 s in production):
a drain still running then has its sockets destroyed once, `server.close`
resolves, and the sequence carries on — `endQueries` still waits for the writes
behind the cut sockets before the barrier goes — answering 1. The real CLI case is
`postgres-cli-lifecycle.test.ts` ("serve cuts a request that never finishes its
body"): red before the fix (~10 s, abandon path), green after (~6.5 s, no step
but the drain reports a failure, so the barrier is released by the sequence). `compose.preview.yaml` got `stop_grace_period: 15s` like
the other compose files, so Docker's default 10 s no longer races the deadline.

**The anti-leak assertion is no longer vacuous under the gate.**
`standalone/http/postgres-cli-lifecycle.test.ts:142-156` read the secret off
`fixture.settings.password` instead of matching `compose.test.yaml`'s literal, so
it also holds in the verify rig, where the password is `rig-only-verify-password`.
The secret is never printed — the failure message carries its length — and the
assertion is kept honest rather than skipped: a rig with `PGPASSWORD_FILE` must
have a non-empty secret, and that equality is asserted.

**The fixture comment told the wrong story.**
`probes/frontend-runtime-fixture.mjs` claimed `nodeEnvironment: "development"` was
about the credential; the credential comes from the rig, not from `runtimeConfig`.
The real reason is the cookie: `browser-session.ts` marks the session cookie
`Secure` in production, and this probe speaks plain HTTP end to end. The comment
now says that, `probes/frontend-runtime.mjs` asserts the attributes it does issue
(`HttpOnly`, `SameSite=Strict`, no `Secure`), and the production policy is pinned at
the port on a real database by
`standalone/http/http-session.test.ts` ("a production host marks the session cookie
Secure, a development host does not") — same transport, same token, only the
environment differs.

**A failed run writes its exit marker.** `scripts/verify-docker.sh:74-100`:
`set -euo pipefail` abandoned `log_wrap` before `=== exit code:` whenever the
command failed, so only passing runs ever got the marker and a failed log looked
truncated. The pipeline is now the condition of an `if` (errexit does not apply to
a condition), `PIPESTATUS` is copied in one assignment — reading `[0]` first
destroys `[1]`, which `set -u` caught as `PIPESTATUS[1]: unbound variable` — and a
`tee` that fails is itself reported as status 1 with a note on stderr, so a log
that cannot be written never reads as success.

### Runs that prove it, all in Docker

| what ran | result | log |
|---|---|---|
| `node --test` on `shutdown`, `postgres-history-drift`, `postgres-cli-lifecycle` (test rig) | 13 tests, 13 pass | `.local/t-1480/400-mediums-tests.log`, exit 0 |
| the same two new tests against the **pre-fix** `databaseReady` and a pre-fix `runShutdown`, restored afterwards | 11 tests, 7 pass, **3 fail + 1 cancelled** (the hung drain times out: no `abandon`) | `.local/t-1480/401-fix-falsification.log` — written before the marker fix, so it ends abruptly with no `=== exit code:` line, which is the other bug in evidence |
| `node -e 'process.exit(3)'` through the wrapper (test rig) | marker written, real status returned: `=== exit code: 3`, shell saw 3 | `.local/t-1480/402-fail-marker.log` |
| `echo intentional && exit 7` through the wrapper (verify rig) | `=== exit code: 7`, shell saw 7 | `.local/t-1480/403-fail-marker-verify.log` |
| `LOG=/dev/full run "echo ok-from-container"` | command succeeded, log unwritable → exit **1**, stdout `=== exit code: 1`, stderr `=== log write failed (tee exit 1); /dev/full is incomplete`; with a failing command the command's 9 wins | not logged, by construction (the log is the unwritable file) |
| `http-session` + `shutdown` + `postgres-history-drift` + `postgres-cli-lifecycle` + `browser-session` + `frontend-proxy-http` (test rig) | 17 tests, 17 pass | `.local/t-1480/404-fix-tests-test-rig.log`, exit 0 |
| `pnpm lint && pnpm typecheck` (verify rig) | both clean | `.local/t-1480/405-lint-typecheck.log`, exit 0 |
| `postgres-cli-lifecycle` + `shutdown` + `http-session` + `postgres-history-drift`, then `pnpm gate:size` (verify rig, `rig-only-verify-password`) | 15 tests, 15 pass; "Size gate passed." | `.local/t-1480/406-verify-rig-tests.log`, exit 0 |
| `pnpm test:frontend:runtime` (verify rig) | 8 tests, 8 pass | `.local/t-1480/407-frontend-runtime.log`, exit 0 |
| `pnpm gate:boundaries` (verify rig) | "no dependency violations found (793 modules, 3533 dependencies cruised)" | `.local/t-1480/408-boundaries.log`, exit 0 |

Not run in this round, and not claimed: `pnpm test` in full, `pnpm verify`,
`gate:runtime`, `gate:package`, `gate:test`, and `pnpm build:frontend` — the
frontend-runtime probe reused the build from the 311 run, which is valid only
because no `frontend/` source changed here.

## The shutdown barrier, closed out (2026-10-01)

The re-review of the runtime fixes left one medium and two lows. One of the three
claims it rested on is false and is now pinned as false by a test; the rest are
fixed.

**False positive, kept out of the documentation on purpose.** The review argued
that a released session barrier lets `migrate --apply`/`restore` run DDL beside a
live write, because destroying a socket does not cancel the request behind it.
The second half is true, the conclusion is not: every writer takes
`pg_advisory_xact_lock_shared` on the maintenance key as the first statement of
its own transaction (`standalone/storage/postgres-transaction.ts:147`,
`standalone/auth/browser-session-store.ts:49-52`), a transaction-scoped lock is
held until COMMIT/ROLLBACK, and the maintenance commands take the same key with
`pg_try_advisory_lock` — no wait (`postgres-maintenance-lock.ts:43-49`,
`postgres-migrations.ts:150`, `postgres-backup.ts:106`). A live writer therefore
refuses maintenance by itself, with or without the application's session hold.
That is now a test rather than an argument:
`standalone/http/shutdown-barrier.test.ts` ("a live writer refuses maintenance on
its own, with no session barrier at all") starts no session, probes a quiet
database (maintenance may start), opens one gated writer (maintenance refused) and
commits it (allowed again).

**What was really wrong: the invariant, not the lock.** `shutdown.ts` claimed
that destroying the remaining sockets made the drain "safe", so the barrier could
go. It does not: the handler's fiber is detached (`Runtime.runFork`) and
`webRequest` builds its `Request` without a `signal`, so nothing interrupts an
in-flight write. The sequence now earns the release instead of asserting it. A new
step, `endQueries`, runs between the drain and the release and ends the **query
pool alone** (`PostgresRuntime.closeQueries`, `postgres-pool.ts:108-190`) — not
`runtime.close()`, which also ends the maintenance pool whose single client is
checked out for as long as the barrier is held, and so would never resolve. The
order is `drain → (destroy) → queries → barrier → pools`, and `destroy` is
documented as best effort rather than as the thing that makes the release safe.

The driver semantics this rests on were read off the **installed** driver and then
run, not taken from documentation (`pg@8.23.0`, `pg-pool/index.js:488-499` and
`127-145`; probe output in `.local/t-1480/420-pg-end-probe.log`): `end()` stays
pending while a client is checked out, `connect()` rejects with `Cannot use a pool
after calling end on the pool` from the first call on, `end()` resolves when the
client comes back, and a second `end()` rejects with `Called end on pool more than
once` — which is why each pool now has one memoised ender shared by `closeQueries`
and `close`.

**Fail closed when the cleanup step refuses.** If `endQueries` rejects, whether a
writer is still live is unknown, so the barrier is **not** released: it dies with
the process, which the server does for us. `closePools` is skipped too (ending the
maintenance pool behind its checked-out client cannot terminate), the failure is
reported as `barrier: kept: …`, `abandon()` is called at once — `process.exit(1)`
in production, not a 10 s wait — and the answer is 1.

**The exit code is set before the first `await`.** `bin/qwbe-invoicing.ts:130`
sets `process.exitCode = 1` before `void runShutdown(...)`, as the failed-boot
path already did at `:100`, and the completed sequence overwrites it with its own
answer. The deadline timer is `unref`'d, so a loop that empties while a step is
pending used to let Node exit 0 on an unfinished shutdown.

**No exit code is asserted as `0 || 1` any more.** Every end-to-end case pins one
value: the occupied port exits exactly 1, the unreachable database exits exactly 0
(nothing ever held the barrier, so every step really does finish), and a new case
on a reachable database — barrier held, `/health/ready` 200 — exits exactly 0 with
no `shutdown <step>:` line in its output.

**And one comment corrected.** `postgres-history-drift.test.ts:257` said the
recycled client "would be the pool's only connection"; `freshRuntime`'s pool is
`max: 4`. It now says what is actually true: exactly one connection has been handed
out at that point, and it is the one under test.

### Runs that prove it, all in Docker

| what ran | result | log |
|---|---|---|
| `pool.end()` / `connect()` semantics probe against `pg@8.23.0` in the container | `end()` pending with a client out → `connect()` rejected → `end()` resolved on release → second `end()` rejected | `.local/t-1480/420-pg-end-probe.log`, exit 0 (probe source kept as `420-pg-end-probe.source.txt`, removed from the tree) |
| `pnpm lint && pnpm typecheck` (verify rig) | both clean | `.local/t-1480/421-lint-typecheck.log`, exit 0 |
| `node --test` on `shutdown`, `shutdown-barrier`, `postgres-cli-lifecycle`, `postgres-history-drift`, `postgres-runtime`, `postgres-maintenance` (test rig) | 33 tests, 33 pass | `.local/t-1480/422-shutdown-tests.log`, exit 0 |
| the same `shutdown` + `shutdown-barrier` files against the **old** order (`barrier` before `queries`, no fail-closed branch), restored afterwards | 8 tests, **2 pass, 6 fail** — the real-PG case fails on `the barrier must still be held while a writer is open`, the unit cases on `actual [ 'drain', 'barrier', 'queries', 'pools' ]`; the false-positive case passes in both, which is what it is for | `.local/t-1480/423-falsification.log`, exit 1 |
| `pnpm gate:size && pnpm gate:boundaries` (verify rig) | "Size gate passed."; "no dependency violations found (794 modules, 3541 dependencies cruised)" | `.local/t-1480/424-gates.log`, exit 0 |
| `node --test` on all of `standalone/{http,storage,ops,auth}` (test rig) | 213 tests, 213 pass | `.local/t-1480/425-http-storage-tests.log`, exit 0 |

Not run in this round, and not claimed: `pnpm verify` in full, `pnpm test` in full,
`gate:runtime`, `gate:package`, `gate:test`, `pnpm build:frontend` and
`pnpm test:frontend:runtime`. The previous full gate,
`.local/t-1480/411-full-verify.log` (**tests 1202 / pass 1202 / fail 0**,
frontend-runtime 8/8, `411-full-verify.exit` = 0), ran on the tree **before** the
changes above and says nothing about them.
