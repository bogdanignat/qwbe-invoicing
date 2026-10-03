# T-1480 step 0 — verification harness, SQLite baseline, PG16 probes

Branch `feat/T-1480-postgresql`, cut from `b3ebd4c` in the main checkout (no
worktree, no commit, no push). Everything below ran in Docker; the host has no
Node, pnpm, PostgreSQL client or openssl in play. Captured 2026-10-01.

This step delivers the harness, the captured SQLite baseline and the blocking
PostgreSQL 16 probes. It translates nothing: no `pg` dependency, no schema,
no adapter, no ops change.

## 1 Harness

| File | Role |
|---|---|
| `Dockerfile.verify` | Verifier image: `node:24.19.0-alpine` pinned by digest, pnpm 11.22.0 via corepack, `openssl` pinned, dirs owned by the host UID/GID |
| `compose.verify.yaml` | Bind `.` → `/app`; named volumes for `/app/node_modules`, `/app/frontend/node_modules`, the pnpm store and `HOME`; `/tmp` on tmpfs; runs as the host user; no port, no application volume |
| `scripts/verify-docker.sh` | `build`, `install [--no-frozen]`, `verify`, `run <cmd>`, `plan <cmd>`, `help`; `LOG=<path>` appends output plus the exit code |
| `compose.pg-probe.yaml` | Throwaway PG16 rig: `postgres:16-alpine` by digest, cluster on tmpfs, no published port, own project name |
| `scripts/pg16-probe.sh`, `scripts/pg16-probe-tar-fixture.mjs` | Probes (a) (b) (c) (f) inside the probe container |
| `probes/schema-inventory.mjs`, `probes/schema-inventory-lib.mjs`, `probes/schema-behavior-lib.mjs` | SQLite baseline capture; dry run by default, `--apply` writes, `--check` exits 1 on drift, idempotent |
| `probes/schema-inventory.test.mjs` | Probes for the capture parsers (CHECK attribution and nesting, per-FK deferrability, trigger classification, statement order and cycle detection) plus the drift gate; runs inside `pnpm test` |

Verified properties: `node --version` = v24.19.0 and `pnpm --version` = 11.22.0
inside the container; Alpine 3.24.1; the four volume mount points owned by
`1000:1000`; the host `node_modules` tree is shadowed, never shared; fixtures
written through the bind mount are host-owned (`bogdan bogdan`).

Two harness defects were found and fixed by running it, not by reading it:

1. pnpm 11 ignores `npm_config_store_dir` and, with `HOME` on another device,
   falls back to `<project>/.pnpm-store` — a 560 MB store appeared inside the
   working tree. Probed: `PNPM_CONFIG_STORE_DIR` is honoured
   (`pnpm store path` → `/pnpm-store/store/v11`), `npm_config_store_dir`,
   `NPM_CONFIG_STORE_DIR`, `PNPM_STORE_DIR` and `~/.npmrc` are not. The stray
   directory was moved to `/tmp` and deleted; nothing tracked was touched.
2. The harness exported `NODE_ENV=development`, which broke `next build`
   (`⚠ You are using a non-standard "NODE_ENV" value`, then
   `TypeError: Cannot read properties of null (reading 'useContext')` while
   prerendering `/_global-error`). `NODE_ENV` is no longer set; every caller
   that cares sets it itself (`standalone/config.ts:22` defaults to
   `development`). With the variable removed `pnpm build:frontend` exits 0.

A third, non-harness gap: the TLS cases of `probes/frontend-runtime.mjs` need
the `openssl` binary (`Error: spawnSync openssl ENOENT`), which the Node base
image does not ship. The verifier image installs `openssl=3.5.9-r0`.

## 2 Baseline `pnpm verify` on SQLite

Frozen dev install first (`pnpm install --frozen-lockfile`, exit 0, "Scope: all
2 workspace projects").

| Run | Log | Exit | Outcome |
|---|---|---|---|
| 1 | `.local/t-1480/03-baseline-verify.log` | 1 | `build:frontend` prerender failure — caused by the harness `NODE_ENV` |
| 2 | `.local/t-1480/05-baseline-verify.log` | 1 | `test:frontend:runtime` 2 TLS cases — missing `openssl` |
| 3 | `.local/t-1480/07-baseline-verify.log` | **0** | green baseline |

Run 3 suite summary: `node --test` 1116 pass / 0 fail / 0 skipped / 0 todo;
`test:frontend:runtime` 8 pass / 0 fail; gates runtime, package-shape,
unit-test, size and boundaries all passed; the boundary cruise reports
`no dependency violations found (753 modules, 3362 dependencies cruised)`.

## 3 SQLite inventory (fixtures in `standalone/parity/`)

Captured by applying every migration plan to a throwaway database and reading
the result back, not by reading SQL by eye.

| Fixture | Contents |
|---|---|
| `sqlite-baseline-objects.json` | per plan: tables with columns, generated columns, CHECK expressions, foreign keys (per-FK deferrability), indexes with collations, full DDL, statement order, reference graph |
| `sqlite-baseline-triggers.json` | all 60 triggers: timing, event, `UPDATE OF` columns, `WHEN`, body, RAISE messages, classification |
| `sqlite-dialect-behavior.json` | GLOB/NOCASE/`json_valid`/money vectors with the observed SQLite answers |
| `size-headroom.json` | 543 measured files, code characters and headroom against the 6000 cap |

`--check` compares only the first three — the golden capture of schema and
behaviour. `size-headroom.json` is excluded on purpose: it moves with every
source edit, so checking it would report drift against the very change being
written. It is refreshed by `--apply` and read as a measurement, not as a
contract.

These fixtures and their generator are **temporary**: they hold the SQLite
behaviour while the PostgreSQL side is written against it. They do not make the
SQLite schema mandatory after the swap — the snapshots stay as the golden
reference, while the generator, `probes/schema-inventory.test.mjs` and the
SQLite runtime are removed at the end of T-1480 as the plan states.

Reference inventory — **26 tables / 30 explicit indexes / 60 triggers**, as the
plan states:

| Plan | Tables | Explicit indexes | Triggers | Statements |
|---|---|---|---|---|
| `invoicing.sqlite` | 23 | 23 | 56 | 102 |
| `documents.sqlite` | 2 | 6 | 4 | 12 |
| `sessions.sqlite` | 1 | 1 | 0 | 2 |

Implicit PK/UNIQUE indexes are reported as 0 because `sqlite_autoindex_*` is
filtered out, exactly as the drift baseline filters it; PostgreSQL's physical
object count will be strictly larger and is not a parity criterion.

Structure facts, all from the fixture:

- 98 CHECK constraints, every one anonymous; they are listed per table with
  ordinal, scope (column or table) and expression. `proposedName` is left
  `null` on purpose — naming is a step 3 decision, this step only records that
  nothing is named today.
- 23 foreign keys in `invoicing.sqlite` (counted as constraint groups from the
  fixture, the self reference `invoice_payments.reverses_payment_id` →
  `invoice_payments.id` included; `issued_invoices` carries 3, and
  `invoice_payments`, `proforma_conversions`, `proforma_invoice_conversions`
  and `proformas` carry 2 each), **4 forward references**:
  `proforma_conversions` (statement 9) → `proformas` (30) and → `invoice_drafts`
  (29); `proforma_invoice_conversions` (13) → `proformas` (30) and →
  `issued_invoices` (31).
- One real cycle: `issued_invoices` ↔ `proforma_invoice_conversions`.
- One self reference: `invoice_payments`.
- Exactly one deferrable foreign key:
  `issued_invoices(organization_id, direct_source_proforma_id, id)` →
  `proforma_invoice_conversions(organization_id, proforma_id, resulting_invoice_id)`,
  `DEFERRABLE INITIALLY DEFERRED`.
- Exactly one generated column: `issued_invoices.direct_source_proforma_id`,
  `STORED`.
- Triggers: all 60 are `BEFORE`, all 60 have RAISE-only bodies. 6 carry a
  subquery in `WHEN` — `invoice_drafts_series_insert`,
  `issued_invoices_lineage_insert`, `proforma_conversions_require_lineage`,
  `proforma_invoice_conversions_match`, `proforma_lines_no_late_insert`,
  `proforma_tax_no_late_insert` — which is the plan's 54 + 6 split read from
  the other side: the predicate, not the body, is what has to move. 11 triggers
  use `UPDATE OF <columns>`.

Size headroom for the files step 2 and step 3 touch (cap 6000):
`api.ts` 5806/194, `browser-session.ts` 5688/312, `http-request-listener.ts`
5654/346, `sqlite-invoices.ts` 5386/614, `ops/cli.ts` 5138/862,
`sqlite-payments.ts` 5011/989, `sqlite-rows.ts` 4526/1474, `sqlite-store.ts`
4433/1567, `sqlite-artifact-repository.ts` 4424/1576, `backup-create.ts`
4216/1784, `sqlite-migration-replay.ts` 3843/2157, `migrations.ts` 3423/2577,
`sqlite-migration-plans.ts` 2085/3915. The tightest file in the repository is
`web/src/components/authoring/BuyerEditor.tsx` at 5997 (headroom 3) — not a
step 2/3 target, but any accidental edit there fails the gate.

### Dialect behaviour observed on SQLite

- GLOB, 6 occurrences in 4 CHECKs, evaluated with the real expressions and the
  column replaced by a bound parameter: money `1.00`, `0.00`, `10.25` satisfied;
  `1.000`, `1.0`, `1`, `x1.00`, `1..00`, `1.00.00`, `-1.00`, `.50`, `1.0a`, ``,
  ` 1.00`, `1.00 `, `1,00` violated. Series `A1`, `INV_2026`, `A-1`, `A`, `1A`
  satisfied; `a1`, `_A1`, `A/1`, `A 1`, `` violated — GLOB is case-sensitive.
  Fingerprint: lowercase `sha256:` + 64 hex satisfied; uppercase hex, short,
  non-hex, wrong prefix, bare hex violated.
- NOCASE is ASCII-only: `'alpha' = 'ALPHA'` → 1, but `'ălpha' = 'Ălpha'` → 0.
  `'alpha' < 'Beta'` → 1 and `'Zeta' < 'alpha'` → 0, so the order is not the
  binary one. Order over the fixture rows:
  alpha, Alpha, ALPHA, beta, Zeta, zeta, Ălpha, ălpha — diacritics sort after
  the ASCII letters. Keyset pages of 2 walk that order; a cursor whose case
  differs from the stored value (`ALPHA`/`c2`) continues at `ALPHA`/`c3`
  without repeating a row, because the bound value is folded too. The planner
  uses the covering index (`SCAN names USING COVERING INDEX names_order`).
- Money into a STRICT TEXT column accepts JS numbers and converts them:
  `1` → `'1.0'`, `1.5` → `'1.5'`, `0.1+0.2` → `'0.30000000000000004'`,
  `1e21` → `'1.0e+21'`, `-0` → `'0.0'`, `10n` → `'10'`, `'1.00'` → `'1.00'`;
  `typeof` is `text` in every case. The plan recorded the stored value as `'1'`;
  observed it is `'1.0'`. No CHECK is added — the fact is recorded so the
  PostgreSQL side is tested on input types, not assumed.
- `json_valid` answers over 23 vectors are in the fixture: 13 valid, 10
  invalid. `json_type` is not a
  validity oracle (`json_type('NaN')` returns `null`, `json_type('{a:1}')`
  returns `object` while `json_valid` is 0).

## 4 PostgreSQL 16 probes

Rig: `compose.pg-probe.yaml`, log `.local/t-1480/08-pg16-probe.log`, exit 0.
Server `PostgreSQL 16.15 on x86_64-pc-linux-musl`; probe database
`datcollate=C datctype=C encoding=UTF8` from
`POSTGRES_INITDB_ARGS=--locale=C --encoding=UTF8`.

**(b) client 16 in the pinned image — PASS (must-pass gate).** `apk`'s own
exit status is read (not the pipeline's), so an index rotation or a missing
network reaches `STOP: installing postgresql16-client=16.15-r0 failed` with
exit 3 instead of a bare 127 from a missing `pg_dump`.
`apk add postgresql16-client=16.15-r0` installs in `node:24.19.0-alpine`
(3.24.1); `pg_dump (PostgreSQL) 16.15`, `psql (PostgreSQL) 16.15`, both majors
asserted as `16`. The Alpine 3.24 repositories also carry `postgresql17-client`
and `postgresql18-client`, so the version must stay pinned. The script exits 3
without a fallback if the major is not 16.

**(a) composite deferrable FK on a `GENERATED ... STORED` column, inside a
cycle — PASS, and repeatable.** Each run creates its own schema
(`probe_run_<utc>_<pid>`), works inside it through `PGOPTIONS=-c search_path=…`
and discards it at the end, leaving `probe_run_%` count 0. `run --rm probe`
removes only the probe container, so the `db` container survives between runs;
the probes were run twice in a row against that same surviving cluster with
identical results (`.local/t-1480/23-pg16-probe-run1.log`,
`24-pg16-probe-run2.log`, both exit 0; a1/a5/a7 fail by design, a0/a2/a4/a6/a8
exit 0). No volume and no pre-existing data is involved: the cluster is on
tmpfs and `docker compose --file compose.pg-probe.yaml down` (never `down -v`,
there is no volume) removes the rig.
- A forward reference inside `CREATE TABLE` fails: `ERROR: 42P01: relation
  "probe_absent" does not exist`. This is the C1 reordering requirement,
  observed.
- Reordered DDL (tables, parent unique index, then both closing FKs by `ALTER
  TABLE`) applies cleanly; `pg_get_constraintdef` reports
  `FOREIGN KEY (organization_id, direct_source_proforma_id, id) REFERENCES
  probe_conversions(...) DEFERRABLE INITIALLY DEFERRED` with
  `condeferrable=t condeferred=t`. PG16 accepts a foreign key whose referencing
  column is generated STORED.
- Child-first insert inside one transaction commits; the generated column holds
  `pf-1`.
- An unmatched deferred key fails at `COMMIT`, not at `INSERT`:
  `ERROR: 23503 ... Key (organization_id, direct_source_proforma_id, id)=(org-1,
  pf-2, inv-2) is not present in table "probe_conversions"`.
- When the generated value is NULL (draft-sourced invoice) the composite FK is
  not enforced — MATCH SIMPLE semantics, same as SQLite.
- Updating a generated column is refused: `ERROR: 428C9: column
  "direct_source_proforma_id" can only be updated to DEFAULT`.

**(f) `IS JSON` vs `json_valid` — PASS, equivalent on all 23 vectors (13 valid,
10 invalid on both sides).**
Valid on both: `{}`, `{"a":1}`, nested, duplicate keys, `utf8-text`,
`nul-escape`, `[]`, `[1,2,3]`, `1`, `-1.5e3`, `"a"`, `true`, `null`.
Invalid on both: `01`, ``, ` `, `{a:1}`, `{'a':1}`, `[1,2,`, `[1,2,]`, `NaN`,
`{"a":1} x`, BOM-prefixed.
`NULL IS JSON` yields NULL, so a `CHECK (x IS NULL OR x IS JSON)` keeps the
current shape. `IS JSON WITH UNIQUE KEYS` is false for duplicate keys while
plain `IS JSON` is true, matching `json_valid`. `'{a:1}'::json` raises
`22P02`, which is why the CHECK must use the predicate and not a cast.

The `nul-escape` vector is now sent byte-identical to the SQLite side
(single-quoted shell variable, dollar-quoted in SQL; the log prints
`nul-escape vector sent verbatim: {"a":"\u0000"}`), and it separates the two
JSON types: `{"a":"\u0000"}` satisfies `IS JSON` and casts to `::json`, but
`::jsonb` raises `ERROR: 22P05: unsupported Unicode escape sequence —
\u0000 cannot be converted to text`. **The translation must keep these columns
TEXT with an `IS JSON` CHECK; a `jsonb` column would reject a document SQLite
accepts today.**

**(c) tar in the real image — observed, and it is BusyBox, not GNU.**
`BusyBox v1.37.0` multi-call `tar`. The flags the ops code uses work:
`tar -czf <out> -C <dir> .` and `tar -xzf <in> -C <dir>` both exit 0 and
round-trip `invoicing.sqlite` plus `artifacts/one.pdf`. On a hostile archive
(`scripts/pg16-probe-tar-fixture.mjs` writes it):
- a member name containing a newline is printed across two lines by both
  `tar -tzf` and `tar -tzvf`, so line- or whitespace-splitting a listing is
  wrong — exactly the parser risk the plan calls out; a name with a space is
  printed intact.
- `tar` interleaves warnings into the same stream as the listing
  (`tar: removing leading '../' from member names`), so a parser must not treat
  every stdout line as a member.
- `../escape.txt` is extracted as `escape.txt` (leading `../` stripped, with a
  warning); `/abs.txt` as `abs.txt` (leading `/` stripped silently).
- a duplicate member is extracted twice, last write wins; a hardlink member is
  materialised; **a symlink member is created as given — `link -> /etc/passwd`
  now sits in the staging directory**, which is why member types must be
  whitelisted before extraction rather than after.
- options, **parsing only, no semantics asserted**: `--numeric-owner`,
  `--no-same-owner`, `--no-same-permissions`, `--exclude=` are accepted by the
  option parser; `--absolute-names` and `--warning=none` are rejected. Whether
  `--no-same-owner` is honoured on extraction as a non-root user is not probed
  here and must not be assumed by the restore step.
- extraction now targets a nested `stage/` and the probe lists the parent, so a
  member that escaped would be visible: after extraction `/tmp/tarhostile`
  holds nothing but `stage/`, and `tar`'s own exit status is read directly
  (`extract exit=0`) instead of the exit status of the `sed` it was piped to.

**(d) dependency-cruiser selector and `node --test` concurrency — observed, and
it changes the plan's option set.** Logs `.local/t-1480/09..13-probe-d*.log`.
- `depcruise --version` → 18.0.0. For `import { Effect } from "effect"` the
  edge resolves to
  `node_modules/.pnpm/effect@3.21.2/node_modules/effect/dist/esm/index.js`
  with `dependencyTypes: ["npm","import"]`, so a `path` selector must match the
  `.pnpm` form. That is the plan's primary clause.
- The plan's alternative is **not available at the pinned version**:
  `enhancedResolveOptions: { symlinks: false }` is rejected with
  `ERROR: The supplied configuration is not valid:
  data/options/enhancedResolveOptions must NOT have additional properties.`
  The 18.0.0 schema (`src/schema/configuration.validate.mjs`) allows only
  `exportsFields`, `conditionNames`, `extensions`, `mainFields`, `mainFiles`,
  `aliasFields`, `cachedInputFileSystem`; the string `symlinks` does not appear
  in it. Step 2's boundary rule must therefore use the `.pnpm`-aware path
  clause, or the pinned version must be raised deliberately.
- Node 24.19.0 lists `--test-concurrency=...` in `--help`; `=` and
  space-separated forms both run, and `--test-concurrency=0` is accepted.

**Deferred on purpose (not probed in this step):** 0b(0) the resolved `pg` /
`@types/pg` versions from a non-frozen install, and 0b(g) the `pg` runtime API
(`Pool`, `PoolClient`, `client.release(err)`, `connectionTimeoutMillis`,
startup GUCs). No version and no signature is guessed here.

## 5 Reproducing

The `openssl` and `postgresql16-client` pins are exact revisions read from a
live Alpine index, so a branch rotation (`-r1`) breaks the build loudly rather
than upgrading silently. `Dockerfile.verify` documents the bump command; the
revision is read from the pinned base image itself. No upgrade is performed in
this step.

```sh
scripts/verify-docker.sh build
scripts/verify-docker.sh install                      # frozen dev install
LOG=.local/t-1480/verify.log scripts/verify-docker.sh verify
scripts/verify-docker.sh run "node probes/schema-inventory.mjs --json"   # dry run
scripts/verify-docker.sh run "node probes/schema-inventory.mjs --apply"  # writes fixtures
scripts/verify-docker.sh run "node probes/schema-inventory.mjs --check"   # drift gate
docker compose --file compose.pg-probe.yaml run --rm probe               # PG16 probes
docker compose --file compose.pg-probe.yaml down                         # teardown (no -v needed)
```

Nothing above deletes a volume, publishes a port, or touches the application
data volume. The probe cluster lives on tmpfs and dies with its container.
