# QWBE Invoicing Foundation

Status: architecture baseline; T-1069 reflected
Source snapshot: QWBE mother repository at `a98d9ef` (main, 31 August 2026; previous baseline `987e11b`)
Conformance review against that snapshot: 2 September 2026, section 18
Package manager: pnpm  
Runtime: Node.js + TypeScript + **Effect 3.x as primary runtime** (`effect`, `@effect/platform`, `@effect/platform-node`) — all cube application logic, host capabilities (Clock, Store, IdGenerator, Auth), and HTTP handling are modelled as `Effect`
UI: React 19 + TypeScript styled with Tailwind CSS 4, built with Vite and served by the standalone host; Effect owns browser API effects, typed failures, cancellation and concurrency, while TanStack Query integrates server state with React. The boundary remains API-first: every cube use-case has a corresponding authenticated HTTP endpoint, and the UI contains no fiscal business logic

## 1. Purpose

Build an invoicing application that:

- runs as a useful standalone application;
- keeps the invoicing domain packaged as a QWBE cube boundary;
- may later integrate with the QWBE mother as an external application/sidecar for
  installation and authentication, without moving invoicing data into the mother's
  database;
- does not own login, passwords, or sessions;
- keeps its business logic unchanged when its host changes;
- follows the isolation, size, test, and package rules proven by QWBE.

This repository is intentionally separate from the QWBE mother repository. The integration seam is a public contract, not a source import from the mother checkout.

## 2. Canonical architecture

A cube is an application, not merely a module inside a separate `Application` abstraction.

A cube may contain other cubes/applications. The intended model is recursive:

```text
runtime root
└── cube/application
    ├── cube/application
    │   └── cube/application
    └── cube/application
```

The current QWBE implementation supports only one `parent/child` level. That is a prototype limitation, not the final product model.

A plugin or package is a delivery unit. A cube is the semantic and runtime application unit.

### Initial shape

Start with one deep cube named `invoicing`. Do not create one cube per table or screen.

Split a child cube only when at least one real boundary exists:

- independent lifecycle or enablement;
- independent data ownership;
- independent permission surface;
- independent installation/removal value;
- a coherent domain that can be understood and tested alone;
- the size gate proves the current cube is too large.

Possible future children such as e-invoice transport, payment reconciliation, or reporting are not created until those boundaries are real.

## 3. Host boundaries

### Standalone mode

```text
standalone host
├── authentication adapter
├── account and organization adapters
└── invoicing cube
```

### Intended future mother integration

```text
mother runtime
├── installation/authentication integration
└── external invoicing application/sidecar
    ├── host adapters
    ├── invoicing cube
    └── standalone-owned SQLite data
```

Bogdan confirmed this external application/sidecar direction for future mother
integration. The mother may establish identity and installation lifecycle, but this
application continues to own invoicing persistence in SQLite. It does not require a
Postgres adapter and does not store invoicing records in the mother's Postgres
schemas. The installation/authentication integration contract is not implemented.

The invoicing cube depends on host-provided contracts. It must not embed a specific
authentication implementation in business logic.

The standalone host is a composition root and operational shell. It is not part of the invoicing business domain.

## 4. Authentication and authorization

### Authentication is global per runtime tree

One runtime tree has one identity/session provider. Login, password verification, token storage, session expiry, and logout belong to the host authentication capability.

The invoicing cube:

- requires an authenticated identity;
- receives the current identity from Effect context/middleware;
- never stores password hashes;
- never parses or validates bearer tokens itself;
- never imports an auth implementation.

The current QWBE public contract exposes:

```ts
type CurrentUser = {
  readonly id: string
  readonly username: string
  readonly roles: ReadonlyArray<string>
  readonly permissions: ReadonlyArray<string>
}
```

Source: QWBE `core/src/kernel/auth-contract.ts` and public export `qwbe-core/auth`.

### Authorization belongs to the cube

The host proves who the caller is. The invoicing cube decides what that caller may do.

Initial permission vocabulary should be owned and declared by the cube, for example:

```text
invoicing:read
invoicing:customer.manage
invoicing:invoice.draft
invoicing:invoice.issue
invoicing:invoice.void
invoicing:proforma.issue
invoicing:settings.manage
payments:read
payments:payment.record
```

Names are provisional until use cases are written. Payments accepts the legacy
`invoicing:read` and `invoicing:payment.record` grants during upgrades, while new
hosts declare `payments:*`. In standalone mode each manifest uses its literal cube
identity prefix. The same static declarations become invalid if a cube is mounted
under another identity, because current validation requires the full mounted
identity as prefix and offers no rebinding hook. No-rewrite mounting therefore
requires either a definition/packaging factory that materializes identity-derived
permissions, commands, events, routes, stores, and entity references, or a future
kernel identity contract. Business logic must not treat these prefixes as permanently canonical.

Authentication and authorization remain separate checks:

1. middleware establishes `CurrentUser`;
2. handlers require a coarse permission;
3. entity authorization checks ownership, grants, or organization scope.

### Organization context is mandatory

An invoice belongs to an issuer/legal entity, not merely to a user.

The application requires a host-provided organization context with at least:

```ts
type CurrentOrganization = {
  readonly id: string
}
```

The final contract must define how the active organization is selected and verified. A client-supplied organization id is never trusted without authorization.

This is a prerequisite contract change in the mother kernel, not a capability available today. Current `CubeTools` has a fixed capability list and cannot inject `CurrentOrganization`. Before mounted operation, QWBE needs a public organization-context or organization-access contract, an explicit manifest declaration, provider cardinality, Effect middleware/context behavior, and mount-time validation. The standalone host may implement the same proposed contract locally, but that does not make mounted integration complete.

## 5. Cube public seam

QWBE cubes export one definition:

```ts
export const cube = defineCube(group, {
  manifest: {
    name: "invoicing",
    tables: [],
    requiresAuth: true,
  },
  create: (tools) => ({
    handlers: {},
  }),
})
```

The interface is:

- one `manifest` declaring identity and owned surfaces;
- one `create(tools)` function receiving host capabilities;
- one returned runtime object containing handlers and optional parts.

The host validates that Effect `HttpApiGroup` endpoint identifiers and handler keys match exactly.

### Manifest-owned declarations

The cube declares only what it owns:

- canonical identity;
- tables and public entity metadata;
- permissions;
- published events;
- sortable public fields;
- authentication requirement;
- capabilities represented by fields the current manifest explicitly supports;
- migrations owned by its package.

The current manifest does not provide a generic capability registry. New capability kinds, including organization context, require an intentional public mother-kernel contract rather than an arbitrary manifest string.

There is no central cube registry to edit.

### Injected tools

Business code receives narrow capabilities rather than global infrastructure:

- cube-owned store;
- publisher-bound event bus;
- mounted catalogue metadata;
- permission metadata;
- explicitly requested identity/entity-permission capabilities.

Do not pass filesystem handles, raw database connections, process control, or foreign stores into the cube.

Sources: QWBE `core/src/cube-contract.ts`, `core/src/kernel/manifest.ts`, and `core/src/kernel/manifest-validation.ts`.

## 6. Isolation and legal communication paths

A cube never imports another cube.

Legal cross-cube paths are:

| Path | Purpose |
|---|---|
| Registry | Public summaries or values selected by the owning cube |
| Bus | Ephemeral event notification by declared string name |
| Space | Relationship declared outside both participating cubes |
| Commands | Permission-checked invocation mediated by the kernel |
| Capability | Narrow typed service declared and injected by the host |

The current intended public boundary is exposed under names such as `qwbe-core/auth`, `qwbe-core/cube`, `qwbe-core/permissions`, and, since QWB-40, `qwbe-core/package` (the shared package contract checker). It is not yet a released compatibility guarantee: `qwbe-core` is private and version `0.0.0`. External consumption requires a versioned published package or an explicit compatibility artifact. The invoicing cube must never import mother kernel internals or sibling cube implementations.

Static boundaries must reject:

- cube-to-cube imports;
- cube imports of kernel store/discovery/state internals;
- direct `node:sqlite` access from cube code;
- direct filesystem/process/module/vm access from cube code;
- circular dependencies.

This is lint isolation, not a security sandbox. Process-level isolation remains a separate future decision.

Source: QWBE `core/.dependency-cruiser.cjs`.

## 7. Data ownership

The invariant inherited from QWBE is:

> One cube equals one directory. Installing it touches no existing file.

Each cube owns its tables and receives a store restricted to those tables. Since QWB-44 (ADR-0001) the mother stores every cube in one Postgres database, one schema per cube, opened under a NOLOGIN role per cube that holds `USAGE` on its own schema and DML on its tables only. Another cube's data is never readable: the engine refuses it, not only the lint. The kernel-facing `Store` interface stayed the six operations (`all`, `page`, `byId`, `insert`, `update`, `count`) over jsonb row bodies with `id`, `type`, `createdAt`, `deleted` as real columns.

Two consequences explain why direct mounted persistence is not the selected
integration direction:

- the cube role has no `CREATE` on its schema, so a directly mounted cube cannot run its own DDL, not even through the declared `usesBatch` raw-SQL capability introduced by QWB-45. Relational tables with constraints and triggers, which is what the invoicing migrations declare, have no legal creation path in mounted mode today;
- SQLite is no longer a mother concept at all. The SQLite dialect in the cube's migrations (`STRICT`, `GLOB`, triggers) is a standalone-host choice and must be treated as such, not as inherited design.

This app therefore remains SQLite-backed and externally integrated. A Postgres
persistence adapter in this repository is not required by the future mother
integration architecture.

For the first invoicing slice, likely owned concepts include:

- invoice drafts and issued invoice snapshots;
- immutable proforma snapshots and one-time conversion records;
- invoice lines;
- separately scoped invoice and proforma numbering sequences;
- issuer snapshot used at issue time;
- customer snapshot used at issue time;
- monetary totals and tax breakdowns;
- immutable lifecycle history.

This list is a domain starting point, not a committed schema.

References to global accounts, organizations, contacts, products, or documents should use stable ids and legal integration paths. Issued legal documents must preserve the relevant snapshot instead of changing when a foreign record changes later.

## 8. Events are not workflows

The QWBE bus is currently:

- in-memory;
- non-durable;
- publisher-bound;
- restricted to manifest-declared events;
- unavailable during cube creation;
- tolerant of a failed listener without stopping later listeners.

A cube cannot publish the reserved `qwbe/` namespace.

Do not use this bus as the source of truth for:

- invoice issuance;
- numbering allocation;
- e-invoice submission;
- retry scheduling;
- payment reconciliation;
- cancellation or correction workflows.

Those operations require durable state, idempotency, an audit trail, and resumable effects. A transactional outbox or workflow journal must be designed when that slice starts. Since QWB-44 the mother kernel writes one `qwbe.outbox` row in the same transaction as every store write (ADR-0001 section 5); nothing consumes it yet, and cubes holding `usesBatch` are exempt. When the invoicing outbox is designed it should align with that table's shape rather than invent a parallel one.

Source: QWBE `core/src/kernel/bus.ts`.

## 9. Identity and future nesting

The cube starts with standalone identity `invoicing`.

Do not hardcode a parent in business logic, route logic, permission checks, event names, storage names, or entity references. Canonical identity must arrive through one identity seam owned by the host/package contract.

The current mother implementation is not yet sufficient for no-rewrite recursive mounting:

- `Manifest.parent` stores one parent slug;
- `fullName` composes only `parent/name`;
- `leafOf` and `parentOf` assume at most two segments;
- discovery rejects grandchildren;
- package identities allow only one or two segments;
- enablement checks only one ancestor.

Therefore mounting `invoicing` below a mother cube without source changes would
require a mother-kernel evolution toward arbitrary identity paths and
identity-derived declarations. Direct mounting is no longer the selected integration
architecture; these constraints remain relevant only to the existing compatibility
artifact.

There is a second blocker: current hierarchy makes the parent directory the install/uninstall unit. A separately shipped child cannot be added below an already installed mother without modifying the mother's directory, which conflicts with the installation invariant. Future integration needs an explicit contributed-child or mount-point contract; current parent/child nesting alone cannot satisfy this repository's delivery goal.

This repository remains standalone and avoids coupling to the temporary two-segment
grammar. Future mother integration is instead an external app/sidecar and remains
unimplemented.

Sources: QWBE `core/src/kernel/scan.ts`, `core/src/kernel/manifest-validation.ts`, `core/src/package-source.ts`, and `core/src/kernel/discovery.ts`.

## 10. Size and split gates

Adopt the QWBE size policy from the first source file, with no inherited baseline debt.

Current mother limits measure code characters after comments and blank lines are removed:

| Limit | Value |
|---|---:|
| Maximum code characters per source file | 6,000 |
| Maximum code characters per unit/cube | 40,000 |
| Maximum source files per unit/cube | 15 |

Unit tests do not count toward size. They are governed by a separate mandatory test gate.

Rules:

- a file over 6,000 code characters is split by responsibility;
- a unit over 40,000 code characters or 15 files is examined for a real child-cube boundary;
- do not raise a cap merely to make a build green;
- do not delete useful comments because comments are not counted;
- do not create tiny pass-through modules only to manipulate the metric.

### Known limitation in the mother size scanner

The current QWBE `unitDirs` discovers only top-level cube directories and recursively counts their descendants (plus the kernel, `pg`, and `metadata` subsystems as their own units since QWB-41/QWB-44; a top-level `frontend/` in a pack is skipped at depth 0 only). A nested child cube is therefore included in the parent's measured unit rather than measured as an independent recursive unit.

This repository must have a native size/test gate from its first implementation commit; the mother scripts cannot discover the standalone layout correctly. Configure the invoicing cube root explicitly, include all production code it owns, exclude standalone-host code and tests from the cube size, and add gate self-tests proving that an oversized or testless cube fails.

The scanner must understand recursive cube roots before child cubes are introduced. Each cube is measured as its own unit while a parent's own size excludes source owned by child-cube directories. Otherwise splitting into a legitimate child cannot reduce the parent's unit measurement.

Sources: QWBE `qwbe.config.json`, `probes/sizecaps.mjs`, and `probes/size-lib.mjs`.

Status on 2 September 2026: this repository's `qwbe.config.json` was raised in four steps to 11,000 / 65,000 / 20 while the mother still enforces 6,000 / 40,000 / 15 with a recorded baseline and a split-first rule. Measured after complete invoice authoring, `cube/invoicing` holds 63,158 code characters across 19 files, with two files over 6,000 (`application/draft-authoring.ts` 10,192 and `domain/validation.ts` 7,447). That is inherited debt this document said would not exist; the repair is either to split (draft authoring and validation, and a child-cube boundary if one is real) or to record a baseline the mother's way, never a silent raise.

On 4 September 2026, adding customer payment terms and product presets exposed the
unit cap. The existing payment lifecycle was extracted into the independent
`cube/payments` bounded context and composed by the standalone host through public
ports. The cap was not raised; invoice and payment cubes remain independently
measured and cannot import each other.

## 11. Tests and verification

Every new cube ships with tests. This repository starts with no `untestedBaseline` exemptions.

Minimum verification layers:

1. unit tests through public domain interfaces;
2. manifest/directory and handler parity tests;
3. authentication and permission refusal tests;
4. store ownership and restart persistence tests;
5. event declaration and payload decoding tests;
6. enable/disable disappearance tests when mounted;
7. package collision, rollback, reinstall, and uninstall tests;
8. decoupling test proving removal leaves the host operational;
9. size and dependency-boundary gates;
10. TypeScript strict typecheck.

The test surface must use the same public interfaces as production callers. Tests should not reach around a seam into kernel internals.

Source: QWBE `probes/testgate.mjs`, `probes/sizecaps.mjs`, and package scripts.

## 12. TypeScript and Effect baseline

Effect is the mandatory application runtime — every cube operation, transaction, and HTTP handler is an `Effect` with typed failures (`ValidationFailure`, `DomainConflict`, `PermissionDenied`, `PersistenceFailure`).

Initial compatibility target from the mother repository:

- Node.js `>=22.18.0`;
- ESM (`"type": "module"`);
- TypeScript source executed with Node type stripping where appropriate;
- `effect` `^3.21.0` — core runtime (required);
- `pg` `^8.23.0` — the mother's Postgres driver since QWB-44 (host concern; the cube never imports it);
- `@effect/platform` `^0.96.0` — HTTP API surface (required);
- `@effect/platform-node` `^0.107.0` — Node adapter (required);
- imports include `.ts` where Node executes source directly.

Rule: do not introduce an alternative async/runtime abstraction. New code must use `Effect.gen`/`Effect.flatMap` and the injected `Clock`/`Store`/`Context` capabilities. Every cube use-case exposed via `InvoicingService` has a 1:1 authenticated HTTP endpoint in `standalone/api.ts`.

Compiler policy:

- `strict`;
- `exactOptionalPropertyTypes`;
- `noUncheckedIndexedAccess`;
- `noImplicitOverride`;
- `noFallthroughCasesInSwitch`;
- `noImplicitReturns`;
- `noUnusedLocals`;
- `noUnusedParameters`;
- `verbatimModuleSyntax`;
- `module` and `moduleResolution`: `nodenext`;
- `noEmit` for the typecheck gate.

This repository intentionally uses pnpm even though the current mother repository uses npm. pnpm is authoring tooling only under the current installer: the mother does not install package dependencies and strips several top-level authoring files while staging. Runtime integration therefore relies on host-provided compatible dependencies and a validated cube artifact, not a shared workspace or lockfile. Pin Node, pnpm, TypeScript, Effect, and platform versions in this repository; do not rely on broad semver coincidence.

Sources: QWBE root `package.json`, `core/package.json`, and `core/tsconfig.json`.

## 13. Package and installation constraints

Since QWB-40 the mother publishes one shared checker, `checkPackageSource` from `qwbe-core/package` (documented in `docs/package-contract.md`). It judges a package root holding `qwbe-package.json` with a `cubes` array next to a `cubes/` directory: declared cubes must exist on disk and vice versa, imports must reach the kernel only through `qwbe-core/*`, and cube code may import none of `fs`, `fs/promises`, `child_process`, `worker_threads`, `module`, `vm`, `sqlite`. Optional rule sets: `readOnly` and `hierarchy` (child declares `parent` and a non-empty `dataMigration`, parent declares `screen: true`, each `manifest.name` equals its path leaf). A pack is expected to ship a `source-contract.test` that runs the checker and asserts zero findings, plus a runtime probe that boots the kernel and attacks the installed cube over HTTP.

This repository's `cube/invoicing/` is a `kind: "cube"` package with `index.ts` at its root. The installer still accepts that shape (`install.ts` reads `cubes = [name]` and requires the root `index.ts`), but the shared checker cannot run on it because it assumes the `cubes/` layout. The nested `cube/invoicing/documents/qwbe-package.json` is a convention of this repository's own gates only; the mother ignores it and discovers `documents` as the child `invoicing/documents` through the directory. Open decision 7 in section 16 covers whether to reshape into a plugin pack.

The future distributable must pass the mother package contract before it becomes discoverable:

- strict package and cube slug grammar;
- no overwrite of existing destinations;
- duplicate cube identities refused before restart;
- TypeScript and ESLint contract validation before publication;
- source tree contains only ordinary files and directories;
- symlinks and special files are refused;
- local development artifacts are excluded from the package;
- staging is atomic and fingerprinted;
- failed installation rolls back its own partial output;
- installation requires a restart because discovery occurs at startup.

The cube artifact must import versioned public QWBE exports, not relative paths into a local mother checkout. The current installer supplies host dependencies; it does not install the pnpm dependency graph from this authoring repository.

A standalone cube package must contain at its package root:

- `qwbe-package.json` with matching package/directory name and `kind: "cube"`;
- `index.ts` exporting the named `cube` definition;
- every cube-owned source dependency reachable from that entry;
- no standalone host, pnpm workspace, local database, test output, or unrelated tooling.

The install artifact and authoring repository are different boundaries. A packaging allowlist must prove exactly what is emitted. Note that the current mother source filter excludes top-level `node_modules`, `.venv`, `.git`, `docs`, `probes`, `test`, and, since QWB-48, `frontend`, `dist`, `build`, plus `package.json`, lockfile, `tsconfig.json`, and `*.test.(m)js`. It still does not exclude `pnpm-lock.yaml`, TypeScript tests, or a plural `tests/` directory; our artifact builder must exclude them itself rather than trusting the mother filter.

Sources: QWBE `core/src/install-contract.ts`, `core/src/package-source.ts`, `core/src/kernel/install.ts`, and `core/src/kernel/install-from.ts`.

## 14. Initial repository shape

This is a target shape, not permission to create every file before it is needed:

```text
qwbe-invoicing/
├── FOUNDATION.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── cube/
│   └── invoicing/              exact cube/package root
│       ├── qwbe-package.json
│       ├── index.ts            named `cube` export
│       ├── domain/             pure invoicing rules and values
│       ├── application/        use cases and explicit ports
│       ├── contracts/          schemas and host-facing seams
│       └── adapters/qwbe/      thin QWBE adapter
├── standalone/                 standalone host and adapters; never packaged
├── probes/                     package, persistence, gate, and decoupling checks
└── tests or colocated *.test.ts
```

The directory `cube/invoicing/` is the source artifact passed to QWBE install-from; its basename and package manifest both say `invoicing`. Standalone code may depend on the cube's public application interfaces, but cube code must not import the standalone host.

Prefer colocated tests. Do not create empty directories or placeholder abstractions.

## 15. Prototype shortcuts not inherited as product design

The mother repository proves boundaries but is not production invoicing infrastructure. Do not copy these current limitations as canonical design:

- generic jsonb row storage without per-cube schema migrations (the kernel has numbered SQL migrations for its own `qwbe` schema since QWB-44; cube tables are still created by the kernel in one fixed shape);
- 32-bit random record ids;
- global entity-name namespace;
- in-memory event delivery;
- row-by-row in-memory entity permission filtering;
- persistence followed by a separate cross-cube ownership claim without one transaction;
- static lint treated as process isolation;
- browser bearer tokens in `localStorage`;
- usernames without a proven database uniqueness constraint;
- logout semantics that revoke every session for a user;
- missing capability providers that fail late instead of refusing mount;
- one hardcoded credential/identity/permission provider topology.

For production standalone auth, prefer secure HttpOnly cookie sessions plus CSRF protection or another explicitly reviewed transport. The invoicing cube still sees only the authenticated principal contract.

All non-auth invoicing endpoints must carry real authentication middleware in the runtime Effect graph, not merely `requiresAuth: true` in metadata. Each handler then performs its own permission and resource/organization checks.

## 16. Deliberately open decisions

These are not solved by copying the mother prototype:

1. Exact invoicing MVP and legal jurisdiction.
2. Organization selection and authorization contract.
3. Immutable issued-invoice model and numbering guarantees.
4. Resolved: standalone persistence remains SQLite. Future mother integration is an
   external app/sidecar for installation and authentication, not a Postgres adapter
   or storage of invoicing data in the mother's database. The integration protocol
   remains open and unimplemented.
5. Durable e-invoice submission workflow.
6. API-only operation versus the selected React + Effect UI adapter.
7. Distribution shape: one `kind: "cube"` package (current, installer-accepted, outside the shared checker) or a plugin pack with `cubes: ["invoicing", "invoicing/documents"]` that the `qwbe-core/package` checker and its `hierarchy` rule can judge.
8. Recursive canonical identity contract required by future mounting.
9. Which domains become child cubes, based on real ownership/lifecycle and size evidence.
10. How stable `qwbe-core/*` contracts are consumed from an external pnpm repository before they are published.

## 17. Rules for the first implementation step

Before writing business code:

1. define the first vertical invoicing use case;
2. define the host capability contracts it needs;
3. define the cube-owned data and invariants;
4. define observable failure types;
5. write one red test through the public interface;
6. implement the smallest complete slice;
7. run type, unit, boundary, and size gates.

Do not copy the mother kernel into this repository. Reuse its public contracts and proven rules; keep the invoicing domain independent of its implementation details.

## 18. Conformance review against `a98d9ef`

Reviewed on 2 September 2026 after the mother's `main` moved from `987e11b` to `a98d9ef` (98 commits, tickets QWB-40 to QWB-48). What the mother changed and where this repository stands:

| Mother change | Ticket | Invoicing status |
|---|---|---|
| Shared package contract checker, `qwbe-core/package`, `docs/package-contract.md` | QWB-40 | Not run: the `kind: "cube"` shape is outside the checker's `cubes/` layout. Own gates cover manifest shape, size, tests, boundaries, but not the `imports-internal` and `cube-builtins` rules the mother enforces. |
| Per-cube field metadata, `version` drift gate, `fields`, `relations`, `searchable` | QWB-41 | Not applicable yet: the cube declares no `entity` and no HTTP handlers. Declare `version` once the cube serves an entity. |
| External frontend auth: `QWBE_ALLOWED_ORIGINS`, CORS allowlist, httpOnly cookie through a proxy, 7-day token | QWB-42 | Aligned in spirit: the standalone host already keeps the token out of the browser behind an HttpOnly `SameSite=Strict` cookie. Session length differs (30 days here, 7 in the mother); not a contract. |
| One Postgres, one schema per cube, NOLOGIN role per cube, kernel outbox, SQLite removed | QWB-43, QWB-44 | Intentionally separate: standalone persists in SQLite with relational tables and triggers. Confirmed future mother integration is an external app/sidecar for installation/authentication, not direct persistence in mother Postgres; the integration is not implemented. |
| `usesBatch` raw-SQL capability (declared, outbox-exempt) | QWB-45 | Not usable as an escape: the role has no `CREATE`, so DDL is refused. |
| Custom field values under the reserved `custom` key of a row body | QWB-46 | No impact on relational tables. `custom` becomes a reserved column name if the cube ever moves to the six-operation store. |
| Installer strips a pack's top-level `frontend/`, `dist/`, `build/` | QWB-48 | No impact: the UI lives in `web/` and `standalone/ui-dist`, outside the package. Future external-app integration remains unimplemented. |
| Size caps unchanged at 6,000 / 40,000 / 15 | - | Not aligned: caps raised locally to 11,000 / 65,000 / 20; `cube/invoicing` measures 63,158 characters across 19 files. Section 10. |

Pre-existing gaps that the pull did not create but that a mounted install would hit first: `create()` returns `handlers: {}`, so the cube serves no HTTP surface under the mother (every endpoint lives in `standalone/api.ts`); `CurrentOrganization` is still a standalone-only contract (section 4); `qwbe-core` is still `0.0.0` and private (open decision 10).
