# T-1480 step 0b(0) + 0b(g) — the `pg` driver: pinned, and probed on PostgreSQL 16

Branch `feat/T-1480-postgresql`, HEAD `b3ebd4c` (no commit, no push). Everything
below ran in Docker; the host has no Node, pnpm or PostgreSQL client in play.
Captured 2026-10-01.

This step adds a dependency and a throwaway probe. It translates no schema,
writes no adapter and connects no application code to PostgreSQL: **the runtime
is still SQLite**, `pg` is imported by `probes/pg-driver-probe.mjs` and nothing
else.

## 1 0b(0) — versions chosen, and why

Queried from the registry inside the verifier container, not from memory
(`.local/t-1480/30-registry-pg.log`, `40-pg-release-ages.log`):

| Package | Chosen | Registry `latest` | `engines` | Published |
|---|---|---|---|---|
| `pg` (dependency) | **8.23.0**, exact | 8.23.1 | `{"node":">= 16.0.0"}` | 2026-08-08 |
| `@types/pg` (devDependency) | **8.23.1**, exact | 8.23.1 | — | 2026-08-17 |

`engines.node` `>= 16.0.0` admits the repository's pinned `24.19.0`
(`package.json:9`); `pg` declares no upper bound and no platform constraint, and
its only peer dependency, `pg-native` (`>=3.0.1`), is optional and is **not**
installed.

`latest` was deliberately not taken. `pg@8.23.1` was published 2026-09-30 —
inside pnpm 11's minimum-release-age window — so `pnpm add pg@8.23.1` silently
wrote a supply-chain exemption into a tracked file:

```
Added 4 entries to minimumReleaseAgeExclude in pnpm-workspace.yaml
  pg-cloudflare@1.4.1  pg-connection-string@2.14.1  pg-protocol@1.16.1  pg@8.23.1
```

Taking a one-day-old release therefore costs the age gate for four packages.
`8.23.0` (seven weeks old) needs no exemption: `pnpm-workspace.yaml` is
untouched, and the lockfile passes the policy check
(`✓ Lockfile passes supply-chain policies (357 entries)`). The first attempt was
reverted with `git checkout --` on the three manifest files before re-adding.

Installed in the container, read back from the package itself:
`pg 8.23.0 {"node":">= 16.0.0"}`.

### Lockfile shape

```
pg@8.23.0:
  resolution: {integrity: sha512-Ip2EQCngowJLGOfCwkFhPXU7/ljlhn6Rxlmy4XYfL2Y+vyRM59+8uR2xqRWKdYmbXmxCFOAmKxBuSUCdF34qLg==}
  engines: {node: '>= 16.0.0'}
  peerDependencies: {pg-native: '>=3.0.1'}  (optional, not installed)
  dependencies: pg-connection-string 2.14.0, pg-pool 3.14.0(pg@8.23.0),
                pg-protocol 1.16.0, pg-types 2.2.0, pgpass 1.0.5
  optionalDependencies: pg-cloudflare 1.4.0
```

`@types/pg@8.23.1` pulls `pg-types ^2.2.0`, `pg-protocol *`, `@types/node *`
(already pinned at 24.10.13). Diff: `package.json` +2 lines, `pnpm-lock.yaml`
+122 lines, nothing else.

Dependencies were added with the non-frozen path **only** for the addition
itself (`pnpm add --workspace-root --save-exact`); every verification afterwards
ran `pnpm install --frozen-lockfile` (`.local/t-1480/52-install-frozen.log`,
exit 0).

### Harness defect met on the way (fixed, worth knowing)

`pnpm add` first failed with

```
[ERR_PNPM_UNEXPECTED_STORE] Unexpected store location
The dependencies at "/app/node_modules" are currently linked from the store at "/app/.pnpm-store/v11".
pnpm now wants to use the store at "/pnpm-store/store/v11" to link dependencies.
```

`/app/.pnpm-store` is the stray in-tree store the step-0 report describes as
moved out and deleted; the dependency volume still recorded it in
`node_modules/.modules.yaml`. `pnpm install` cannot repair that pointer here:
frozen, non-frozen and `--force` all answer `Already up to date` and never
re-link (`.local/t-1480/33`, `35`, `36`). The pointer was repointed in place,
inside the volume, to `/pnpm-store/store/v11`; the existing package files are
hard links and survive the deleted store directory, which is why the previous
`pnpm verify` ran green on them. A volume created from scratch starts correct and
does not need this.

## 2 0b(g) — the driver API, observed

Rig: `compose.pg-driver-probe.yaml` — `postgres:16-alpine` pinned by digest,
cluster on tmpfs, no published port, own compose project, `trust` inside the rig
only (the shipped stack uses `POSTGRES_PASSWORD_FILE`, plan step 1). The probe
runs on the application's own base image (`node:24.19.0-alpine` by digest), binds
the tree read-only and mounts the verifier's dependency volume read-only. Probe:
`probes/pg-driver-probe.mjs` — one script, every check asserts, every wait bounded
(checks, each teardown step, plus a 60 s watchdog over the teardown), own schema
`probe_pgdrv_<utc>_<pid>` dropped unconditionally in a `finally` and verified gone
by name. Schemas left by *other* runs are reported as an observation, never as a
failure, so a surviving `db` container cannot poison the next run. Setup failures
exit 3 after dropping what they created. The cluster is initialised with
`--locale=C`, so no collation conclusion may be drawn from these logs.

Server `PostgreSQL 16.15 on x86_64-pc-linux-musl`; driver `pg 8.23.0`.
**18/18 checks passed, exit 0** (`.local/t-1480/62`, `64-pg-driver-probe-fixed*.log`;
the pre-review version was 15/15 ×3 in `50`, `51`, `55`).

| Check | Verdict | Observed |
|---|---|---|
| g1 startup GUCs | PASS | `SHOW statement_timeout` `1500ms`, `idle_in_transaction_session_timeout` `2s`, `lock_timeout` `1s` — in force on the first query, no `SET` round trip; `search_path` arrives through `PGOPTIONS` |
| g2 single-client transaction | PASS | `BEGIN`/`COMMIT` row visible, `BEGIN`/`ROLLBACK` row absent, 0 sessions `idle in transaction` |
| g3 `release(err)` vs `release()` | PASS | `release(new Error(...))` → `pool.totalCount` 0, next checkout a different backend (pid 73 → 74); plain `release()` → `idleCount` 1 and the same pid recycled |
| g4 `connectionTimeoutMillis`, saturated pool | PASS | `max: 1`, held client → `Error: timeout exceeded when trying to connect` after 301 ms (bound 300 ms) |
| g5 `connectionTimeoutMillis`, connect that never answers | PASS | a TCP sink inside the probe process accepts the connection and never speaks → `Connection terminated due to connection timeout` after 702 ms (bound 700 ms), no `code`. Deterministic by construction: no guessed address. `connectionTimeoutHandle` is cleared only at `_handleReadyForQuery`, on a connect error or on end (`node_modules/pg/lib/client.js:206,377,406`), so a completed handshake without a startup answer keeps the timer armed |
| g6 `statement_timeout` fires | PASS | `SELECT pg_sleep(5)` under 300 ms → `57014`; the transaction stays open and aborted, every later statement `25P02` until `ROLLBACK`; after `ROLLBACK` the client is usable, `pool.end()` → `totalCount` 0, 0 sessions `idle in transaction` |
| g7 `idle_in_transaction_session_timeout` fires | PASS | server log `terminating connection due to idle-in-transaction timeout`, then client `error` event `Connection terminated unexpectedly`; the next query rejects with **no `code`**: `Client has encountered a connection error and is not queryable`; the open `INSERT` is gone, 0 sessions left |
| g8 `lock_timeout` fires | PASS | contended `FOR UPDATE` → `55P03` after 404 ms. `pg` 8.23.0 sends `lock_timeout` as a startup GUC natively (`node_modules/pg/lib/client.js:561`), so the documented `options=-c …` fallback is **not** needed |
| g9 error classes | PASS | `23505` (`constraint parent_tag_key`, `table parent`), `23503` (`child_parent_id_fkey`, `child`), `23514` (`checked_amount_check`, `checked`), `22P02`, `22001`. `22P02`/`22001` carry no `constraint`/`table`. A failed statement outside an explicit transaction leaves the session usable |
| g10 `int8` decoding | PASS | default: `1::int8` → `"1"` (string), `9007199254740993::int8` → `"9007199254740993"`. An explicit per-client decoder (`client.setTypeParser(20, …)`, safe-integer or throw) returns `42` as a number and rejects the unsafe value with `RangeError: int8 out of safe integer range: 9007199254740993`. A second client of the **same pool** still answers a string — `TypeOverrides` is per client, so **no global parser is installed**. Isolation is between *clients*, not between *checkouts*: after a plain `release()` the recycled connection still decodes `int8` to a number, so step 3 must install parsers once per pool (`pool.on('connect')`), never per request |
| g11 money into `TEXT` | PASS | `'1.00'`→`1.00`, `1`→`1`, `1.5`→`1.5`, `0.1+0.2`→`0.30000000000000004`, `1e21`→`1e+21`, `-0`→`0`, `10n`→`10`; `pg_typeof` `text` in every case |
| g12 Effect success | PASS | `acquired → begin → commit → released`, row committed, client back in the pool |
| g13 Effect failure | PASS | `acquired → begin → rollback → released`, row absent |
| g14 Effect interruption during acquire | PASS | interrupt at 100 ms lands inside the 300 ms acquire → exact sequence `acquired → begin → rollback → released`, exit `Interrupted`, no row. `use` pushes a `use-started` marker and it is **absent**, so "`use` never ran" is asserted, not inferred; the acquire still completed and the finalizer still ran |
| g15 Effect interruption with a query in flight | PASS | `acquired → begin → pending-settled → rollback → released` — the in-flight `pg_sleep(1)` is awaited **before** `ROLLBACK` on the shared connection; `idleCount` 1, 0 sessions `idle in transaction` |
| g16 failure inside the acquire | PASS | `SELECT 1 / 0` before `BEGIN` → `acquired → acquire-failed:22012 → destroyed`, `totalCount` 0, pool usable again. `acquireUseRelease` never runs the finalizer for a failed acquire, so the acquire itself has to return the client it already took |
| g17 COMMIT on a lost connection | PASS | backend terminated while the transaction is open → `acquired → begin → commit-failed:Error → destroyed`, never `released`, `totalCount` 0, the row is not committed |
| g18 ROLLBACK on a lost connection | PASS | same loss plus a domain failure → `acquired → begin → rollback-failed:Error → destroyed`, never `released`, `totalCount` 0 |

### Money delta against the SQLite baseline — recorded, not imposed

The baseline stores a JS `1` into a `STRICT TEXT` column as `'1.0'`
(`standalone/parity/sqlite-dialect-behavior.json`). PostgreSQL stores the same
value as `'1'`; `1e21` is `'1e+21'` there and `'1.0e+21'` on SQLite, `-0` is
`'0'` versus `'0.0'`. Both accept a JS number for a `TEXT` money column and both
keep the column `text`. **No new contract is introduced here** — the delta is on
the record so step 3 tests money on input types instead of assuming the SQLite
rendering. The money `CHECK` is a GLOB pattern on SQLite that only `'1.00'`-shaped
strings satisfy, so passing a raw JS number stays a caller bug on either engine.

### What the prototype is, and is not

The Effect part of the probe is a **stage prototype**, not the final pool. It
exists to answer five questions, and each answer is observed by a check, not
reasoned: the finalizer runs on success, failure and interruption (g12–g15);
acquire is not interruptible and `use` is skipped when the interrupt lands there
(g14, by the absent marker); a pending query must be settled before `ROLLBACK`
because both share one connection (g15); a failed `ROLLBACK` destroys the client
(g18); and the two paths that `acquireUseRelease` does **not** cover — a failure
inside the acquire (g16) and a failing `COMMIT` (g17) — must return the client
themselves, destroyed. The real adapter is step 3 work and is not in this step.

### Teardown, probed as well

`pool.end()` never settles while a client is still checked out, so an unbounded
teardown turns any leak into a container that hangs with no verdict. Every
teardown step is bounded, a 60 s watchdog sits over the phase, and the schema is
dropped in a `finally` before any assertion. Observed, not argued: with
`PROBE_FAULT=leak-client` the probe leaves a client checked out on purpose and the
run ends

```
· teardown pool.end: teardown pool.end: exceeded 10000ms bound
18/18 checks passed
TEARDOWN FAILED — Error: teardown pool.end: exceeded 10000ms bound
```

with exit **3** (`.local/t-1480/63-pg-driver-probe-fault.log`), the schema dropped
— the next run reports no foreign leftover.

## 3 Verification

| Command | Log | Exit |
|---|---|---|
| `scripts/verify-docker.sh install` (frozen, after the add) | `.local/t-1480/52-install-frozen.log` | 0 |
| `docker compose … run --rm driver-probe` ×3 (pre-review probe) | `50`, `51`, `55-pg-driver-probe*.log` | 0, 0, 0 — 15/15 each |
| `docker compose … run --rm driver-probe` ×2 (post-review probe) | `62`, `64-pg-driver-probe-fixed*.log` | 0, 0 — **18/18** each |
| `docker compose … run --rm -e PROBE_FAULT=leak-client driver-probe` | `63-pg-driver-probe-fault.log` | **3**, bounded, schema dropped |
| `pnpm exec eslint probes/pg-driver-probe.mjs` | `54`, `65-lint-probe.log` | 0 |
| `scripts/verify-docker.sh verify` | `56`, `67-verify-after-review.log` | **0** |

`pnpm verify` after the dependency: `node --test` **1125 pass / 0 fail / 0
skipped**, `test:frontend:runtime` **8 pass / 0 fail**, runtime / package-shape /
unit-test / size / boundary gates all passed, boundary cruise
`no dependency violations found (753 modules, 3362 dependencies cruised)` —
identical to the step-0 baseline.

One honest failure on the way, not hidden: the first `pnpm verify` exited 1 on
`eslint` — `'setTimeout' is not defined no-undef` ×2 and `'clearTimeout' is not
defined` in the new probe (the repo's flat config gives `.mjs` no browser
globals; `probes/frontend-runtime-fixture.mjs:9` imports them from
`node:timers`). Fixed the same way, probe re-run, verify green.

The boundary rule that forbids `pg` inside `cube/` is **plan step 2** work and is
not in this step; today nothing imports `pg` except the probe, which lives in
`probes/`.

## 4 Reproducing

```sh
scripts/verify-docker.sh install                                          # frozen
docker compose --file compose.pg-driver-probe.yaml run --rm driver-probe  # 18 checks
docker compose --file compose.pg-driver-probe.yaml run --rm \
  -e PROBE_FAULT=leak-client driver-probe                                 # bounded teardown, exit 3
docker compose --file compose.pg-driver-probe.yaml down                   # no volume, no -v
LOG=.local/t-1480/verify.log scripts/verify-docker.sh verify
```

Nothing above deletes a volume, publishes a port or touches an application
volume. The probe cluster lives on tmpfs and dies with its container; the
dependency volume is mounted read-only, and the only parts of the tree the probe
container sees are `probes/pg-driver-probe.mjs` and `package.json` — not `.env`,
not the sources.
