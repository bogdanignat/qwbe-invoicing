# QWBE Invoicing Foundation

Status: architecture baseline; T-1876 direction (standalone plugin pack), with plugin selection through `QWBE_PLUGINS` and conditional plugin composition in the kernel
Source snapshot: QWBE mother repository at `a98d9ef` (main, 31 August 2026; previous baseline `987e11b`); structural reference: `qwbe-plugins/crm-pack`
Conformance review against that snapshot: 2 September 2026, section 18 (historical)
Package manager: pnpm
Runtime: Node.js + TypeScript + **Effect 3.x as primary runtime** (`effect`, `@effect/platform`, `@effect/platform-node`) — all cube application logic, host capabilities (Clock, Store, IdGenerator, Auth), and HTTP handling are modelled as `Effect`
UI: React 19 + TypeScript styled with Tailwind CSS 4, a Next.js 16 App Router application in `frontend/` that reaches the kernel only through its BFF under `/api/qwbe/*`; TanStack Query integrates server state with React. The boundary remains API-first: every cube use-case has a corresponding authenticated HTTP endpoint, and the UI contains no fiscal business logic

## 1. Purpose

Build an invoicing application that:

- runs standalone: its own kernel, its own PostgreSQL, its own login and sessions;
- is shaped as one QWBE plugin pack: `invoicing` is the main cube, `payments` and
  `efactura` are plugins, i.e. optional child cubes enabled by configuration;
- copies from QWBE (`crm-pack`) only the package structure and the isolation, size, test,
  and boundary rules, not its runtime, installer, or persistence;
- keeps its business logic unchanged when its host changes;
- does not implement mother integration; the future contract is text only (section 19).

This repository is intentionally separate from the QWBE mother repository and has no
dependency on `qwbe-core`. Nothing is imported from a mother checkout.

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

Standalone is the only runtime mode:

```text
kernel                      composition root, own PostgreSQL, own login
├── authentication adapter  API token, browser session
├── organization adapter    ORGANIZATION_ID
├── plugin selection        QWBE_PLUGINS, read once at start
└── invoicing (required)
    ├── parties, customers, catalog, issuer, drafts, issuance, corrections, documents (required)
    ├── payments (plugin, required: false)
    └── efactura (plugin, required: false)
```

The mother installs, mounts, or hosts nothing of this application, and invoicing data
never moves into its database. If a mother is connected later, it is an external caller of
this application's API from its own BFF, under section 19. That is not implemented.

The cubes depend on host-provided contracts and never embed an authentication
implementation in business logic. The kernel is a composition root and operational shell,
not part of the invoicing domain.

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

Shape borrowed from QWBE `core/src/kernel/auth-contract.ts`; it is declared locally, not imported.

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

Each manifest uses its literal leaf identity as prefix. Payments keeps the `payments:*`
prefix and the legacy aliases `invoicing:read` and `invoicing:payment.record` under
`invoicing/`, so grants and migration ledger keys do not change. When the
payments plugin is off its routes are not mounted and the kernel grants no `payments:*`
permission; `invoicing:read` stays, because it is the invoicing base permission. e-Factura
declares no permission and needs none. Identity rebinding
under another mounted name is outside the direction (decision 8 in section 16); the
prefixes are local and differ from the full-identity prefix `qwbe-core` would require
(section 13).

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

The kernel provides it: standalone reads `ORGANIZATION_ID` and refuses requests when it is
missing. A client-supplied organization id is never trusted. No mother-kernel organization
contract is needed for this direction. A future external caller would carry an
organization claim that the kernel maps to a local organization and checks against the
caller's grants (section 19).

## 5. Cube public seam

### Common shape and local runtime contract

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

This repository copies the common shape and nothing else: a named `cube` export, `manifest`
plus `create`, `manifest.name` equal to the path leaf, an explicit `parent` on children,
and `required` (section 13). The objects are plain; there is no `defineCube` import and no
local wrapper imitating it. The runtime contract is local: `create()` returns
`handlers: {}` and the kernel owns every HTTP endpoint. It mounts only those of the
required cubes and the selected plugins, for routing and OpenAPI alike: a disabled plugin's
route is a 404 from the router, and its operations keep their ids in the `invoicing` group.
Manifests are static: the
plugin selection filters the active surface and never rewrites a manifest.

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

The manifest has no generic capability registry. Organization context is provided by the local kernel (section 4), not declared as a manifest string.

There is no central cube registry to edit.

### Injected tools

Business code receives narrow capabilities rather than global infrastructure:

- cube-owned store;
- publisher-bound event bus;
- mounted catalogue metadata;
- permission metadata;
- explicitly requested identity/entity-permission capabilities.

Do not pass filesystem handles, raw database connections, process control, or foreign stores into the cube.

Shape references (not imported): QWBE `core/src/cube-contract.ts`, `core/src/kernel/manifest.ts`, and `crm-pack`.

## 6. Isolation and legal communication paths

A cube never imports a cube of another top-level tree. Inside one tree the rules below
apply.

Legal paths between separate trees are:

| Path | Purpose |
|---|---|
| Registry | Public summaries or values selected by the owning cube |
| Bus | Ephemeral event notification by declared string name |
| Space | Relationship declared outside both participating cubes |
| Commands | Permission-checked invocation mediated by the kernel |
| Capability | Narrow typed service declared and injected by the host |

This repository does not import `qwbe-core` (decision 10) nor any mother kernel internals.

Static boundaries must reject:

- imports between separate top-level trees, and past a unit's `index.ts` inside a tree;
- cube imports of kernel store/discovery/state internals;
- direct `node:sqlite` and direct PostgreSQL driver (`pg`, `pg-pool`, `pg-native`, `pg-cursor`) access from cube code;
- direct filesystem/process/module/vm access from cube code;
- circular dependencies.

This is lint isolation, not a security sandbox. Process-level isolation remains a separate future decision.

The isolation unit is a top-level cube together with its child cubes, as in the mother's
`no-cube-to-cube` rule (which captures only the first path segment under `cubes/`).
`invoicing`, `payments`, and `efactura` form one tree: `cubes/invoicing/{payments,efactura}`.
They are no longer separate trees that may not import each other.
`probes/boundary-rules.mjs` keeps the separate-tree refusal and its tests on synthetic
top-level trees, even though the application has a single tree.

Inside one tree the gate is stricter than the mother. A child cube may import the kernel of any ancestor (the parent's domain, ports and contracts); every other unit, whether a child seen from its parent, a sibling or a nested child, is entered only through its exact `index.ts`, type-only imports and re-exports included. Each child's interior stays private to it, and the parent never reaches past a child's index, so the graph stays acyclic. No edge is exempt. A child that persists documents of its own declares its own transaction port (`ProformaTransaction` in `issuance/`, `CorrectionsTransaction` in `corrections/`, `PaymentsTransaction` in `payments/`, beside `CustomersTransaction`, `CatalogTransaction` and `IssuerTransaction`), and the composition root in `application/invoicing.ts` intersects the required ports with the kernel port; the host implements the intersection over one connection.

Plugins stay optional in the graph. The boundary gate refuses any import from a
`required: true` unit into a `required: false` unit, and `invoicing/index.ts` does not
re-export the plugins. The kernel composes a plugin only when it is selected
(`kernel/api/api-services.ts`). A plugin's internal modules import their leaf
modules, never their own `index.ts`, so re-exports create no cycle.

Source: QWBE `core/.dependency-cruiser.cjs`.

## 7. Data ownership

The invariant inherited from QWBE is:

> One cube equals one directory. Installing it touches no existing file.

Each cube owns its tables and receives a store restricted to those tables. Since QWB-44 (ADR-0001) the mother stores every cube in one Postgres database, one schema per cube, opened under a NOLOGIN role per cube that holds `USAGE` on its own schema and DML on its tables only. Another cube's data is never readable: the engine refuses it, not only the lint. The QWBE mother kernel's `Store` interface stayed the six operations (`all`, `page`, `byId`, `insert`, `update`, `count`) over jsonb row bodies with `id`, `type`, `createdAt`, `deleted` as real columns.

Two consequences explain why mounted persistence is outside the direction:

- the cube role has no `CREATE` on its schema, so a directly mounted cube cannot run its own DDL, not even through the declared `usesBatch` raw-SQL capability introduced by QWB-45. Relational tables with constraints and triggers, which is what the invoicing migrations declare, have no legal creation path in mounted mode today;
- the dialect in the cube's migrations is a choice of this repository's kernel and must be treated as such, not as inherited design. Since T-1480 that dialect is PostgreSQL 16 (named CHECK constraints, trigger functions, regex predicates in place of `GLOB`, folded expression indexes in place of `NOCASE`); before it, it was SQLite's (`STRICT`, `GLOB`). Neither was ever a mother concept.

This app therefore stays standalone and owns its own database. Since T-1480 it is
PostgreSQL 16, owned by this repository's kernel: the application role owns the `public`
schema it migrates. That is not the mother's topology.

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

### Schema baselines during development

While the project is in development (the "STADIU" section of `CLAUDE.md`), every cube owns exactly one migration, `<cube>-001-baseline`, holding the current definition of the tables its manifest declares, with their indexes and triggers; `kernel/storage/schema-baseline.test.ts` asserts that each baseline creates exactly the declared tables. A schema change edits the owning baseline instead of adding a migration. A database created from an earlier baseline is drift: `migrate` refuses it before writing and `doctor` reports it, and the answer is to recreate the database, which drops its data. The migrator never deletes a database itself. The runner applies the foundation scope once and then each cube's migrations in cube order—customers, catalog, issuer, invoicing, payments, in one PostgreSQL database—with a cube whose tables others reference first, never sorted by name. The foundation scope is the host's: it owns `qwbe_abort()`, the single trigger function every refusal trigger calls, so the cube baselines are no longer self-sufficient SQL (`.architecture/contract.json`, kept in personal-hub, local copy ignored by git; decision `functii-de-trigger-in-scope-foundation`). Numbered incremental migrations (`<cube>-002-...`) return only when the development stage ends. The immutability triggers are part of the baselines, and `kernel/ops/kernel.test.ts` still asserts that every one of them exists after migration.

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

The main cube has the identity `invoicing`; each child declares its leaf `name` and
`parent: "invoicing"` in its manifest, and nowhere else. Do not hardcode a parent in
business logic, route logic, permission checks, event names, storage names, or entity
references.

For context, the current mother implementation is not sufficient for recursive mounting:

- `Manifest.parent` stores one parent slug;
- `fullName` composes only `parent/name`;
- `leafOf` and `parentOf` assume at most two segments;
- discovery rejects grandchildren;
- package identities allow only one or two segments;
- enablement checks only one ancestor.

Mounting this pack below a mother cube, identity rebinding, and a contributed-child or
mount-point contract are outside the direction (decision 8 in section 16). The pack's own
hierarchy has two levels, `invoicing` and its children, which the current grammar accepts.
The constraints above are kept as context only.

Context sources: QWBE `core/src/kernel/scan.ts`, `core/src/kernel/manifest-validation.ts`, `core/src/package-source.ts`, and `core/src/kernel/discovery.ts`.

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

The same 6,000-character file cap also covers production TypeScript/JavaScript in
`kernel/` and `frontend/src/`, via `sizeFileRoots`. These are file-only roots, not
fake cube units: the 40,000-character / 15-file unit caps still apply to each cube's own
sources. Test/spec/test-support sources and ordinary build/dependency directories are
not production measurements. Overlapping roots are deduplicated and invalid roots
fail the gate. `bin/` and root tooling/config files are outside this extension.

Host adapters follow the existing domain ports rather than arbitrary file slices.
`postgres-store.ts` owns transaction lifetime and composes same-connection adapters
over one pooled client; payments has its own adapter and store. API handlers receive a request-scoped service
access function, not database or renderer factories. Service construction remains
per request. Browser transport/session state has one owner, workflow hooks compose
pure state and domain clients, and views compose presentation components. Existing
public entry points remain facades; internal modules import leaf dependencies, not
their own facade. This applies the CRM pack's ownership/injected-dependency approach
without copying its mother-bound store, runtime mounting or metadata-driven UI.

### Known limitation in the mother size scanner

The current QWBE `unitDirs` discovers only top-level cube directories and recursively counts their descendants (plus the QWBE mother kernel, `pg`, and `metadata` subsystems as their own units since QWB-41/QWB-44; a top-level `frontend/` in a pack is skipped at depth 0 only). A nested child cube is therefore included in the parent's measured unit rather than measured as an independent recursive unit.

This repository must have a native size/test gate from its first implementation commit; the mother scripts cannot discover the standalone layout correctly. Configure the invoicing cube root explicitly, include all production code it owns, exclude this repository's kernel code and tests from the cube size, and add gate self-tests proving that an oversized or testless cube fails.

Each cube is measured as its own unit while a parent's own size excludes source owned by child-cube directories; otherwise splitting into a legitimate child cannot reduce the parent's measurement. The gates discover units from the `cubes` list of the single package manifest (section 13), not from per-directory manifests; a missing manifest or zero units fails the gate.

Sources: QWBE `qwbe.config.json`, `probes/sizecaps.mjs`, and `probes/size-lib.mjs`.

Status on 2 September 2026: this repository's `qwbe.config.json` was raised in four steps to 11,000 / 65,000 / 20 while the mother still enforces 6,000 / 40,000 / 15 with a recorded baseline and a split-first rule. Repaired on 5 September 2026: the cube was split into component cubes and the caps returned to 6,000 / 40,000 / 15 with no baseline needed. Measured after complete invoice authoring, `cubes/invoicing` holds 63,158 code characters across 19 files, with two files over 6,000 (`application/draft-authoring.ts` 10,192 and `domain/validation.ts` 7,447). That is inherited debt this document said would not exist; the repair is either to split (draft authoring and validation, and a child-cube boundary if one is real) or to record a baseline the mother's way, never a silent raise.

On 4 September 2026, adding customer payment terms and product presets exposed the
unit cap. The payment lifecycle was extracted into its own bounded context, composed by
the kernel through public ports, and the cap was not raised. It now lives in
`cubes/invoicing/payments` as a plugin and stays its own measured unit with its own ports.
The same holds for `cubes/invoicing/efactura`. The mappers from invoicing's model to the
e-Factura document stay in `kernel/efactura/` as a host adapter: the plugin uses 37,340 of
its 40,000 code characters and the mappers would add about 9,800, which only an artificial
child cube could absorb. With e-Factura off the XML routes are not mounted, so the mappers
are never called.

## 11. Tests and verification

Every new cube ships with tests. This repository starts with no `untestedBaseline` exemptions.

Minimum verification layers:

1. unit tests through public domain interfaces;
2. manifest/directory and handler parity tests;
3. authentication and permission refusal tests;
4. store ownership and restart persistence tests;
5. event declaration and payload decoding tests;
6. plugin selection tests for all four `payments`/`efactura` combinations: the app boots,
   login, readiness, issuance, proforma, storno, and PDF work; a disabled plugin's routes,
   OpenAPI entries are absent and `eFacturaStatus` is `null` with e-Factura off; re-enabling
   keeps its data and idempotency; an unknown name in `QWBE_PLUGINS` refuses start
   (`kernel/plugins.test.ts`, `kernel/http/plugins-http.test.ts`). That the UI sends no
   request to a disabled plugin is the frontend's to prove and is not covered here yet;
7. package manifest tests: every declared unit exists, no unit is undeclared or duplicated,
   a missing manifest or zero units fails;
8. decoupling: disabling a plugin leaves the host and every required cube operational;
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

Rule: do not introduce an alternative async/runtime abstraction. New code must use `Effect.gen`/`Effect.flatMap` and the injected `Clock`/`Store`/`Context` capabilities. Every cube use-case exposed via `InvoicingService` has a 1:1 authenticated HTTP endpoint in `kernel/api/api.ts`.

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

This repository intentionally uses pnpm even though the current mother repository uses npm. The mother installs nothing from it, so no dependency is expected from a host: the application ships its own pinned Node, pnpm, TypeScript, Effect, and platform versions in its Docker image. Do not rely on broad semver coincidence.

Sources: QWBE root `package.json`, `core/package.json`, and `core/tsconfig.json`.

## 13. Package contract

The package copies the `crm-pack` structure: one plugin pack, a parent with children.

- One `qwbe-package.json` at the package root, which is the repository root:
  `name: "invoicing-pack"`, `kind: "plugin"`, and a `cubes` array listing all 11 units,
  `invoicing` and `invoicing/<child>`, plugins included. There are no per-directory manifests.
- The inventory is static. Neither the gates nor the migrations filter it by configuration;
  migrations always run for every unit, so a disabled plugin keeps its schema and data.
- Each unit's `manifest` declares `name` (equal to its path leaf), `parent` for children,
  and `required`: `true` for `invoicing` and its eight components, `false` for `payments`
  and `efactura`. The field has the `qwbe-core` manifest shape; the semantics are this
  kernel's own.
- `QWBE_PLUGINS` selects the plugins at start (`kernel/config.ts`, `kernel/plugins.ts`):
  absent means every plugin, empty means none, any name that is not a plugin refuses start,
  spaces are ignored and duplicates tolerated, and any change needs a restart. The known
  names are the units whose manifest says `required: false`. Required units are always active.
- The gates check the declared list against the tree: declared units exist, no unit is
  undeclared or duplicated, paths are valid, and a missing manifest or zero units fails.
- Cube code may not import `pg`, `node:fs`, process, module, or vm APIs; this repository's
  `cube-does-not-touch-runtime-infrastructure` rule enforces it.

What we do **not** claim: compatibility with the `qwbe-core/package` checker
(`checkPackageSource`). The contract is local and explicit. Known differences:

- permission prefixes: the checker requires the full identity (`invoicing/payments:read`);
  this pack keeps leaf prefixes (`payments:read`, section 4);
- the checker treats a directory with an `index.ts` at child level as a cube, so
  `cubes/invoicing/contracts/index.ts` would be read as a child;
- its `hierarchy` rule requires `screen: true` on the parent, which `invoicing` does not
  declare.

No fake data migrations are added to imitate the CRM pack.

The mother installs nothing (decision 4 in section 16): there is no installer, artifact
builder, or install-from flow, and no packaging allowlist. Distribution is the Docker image
and Compose bundle (`PRODUCT.md` section 7).

References (not imported): `crm-pack/qwbe-package.json`, QWBE `core/src/kernel/manifest.ts` (`required`).

## 14. Repository shape

This is the shape the repository has; a new directory appears only when a file needs it:

```text
qwbe-invoicing/
├── FOUNDATION.md
├── qwbe-package.json           invoicing-pack, kind "plugin", all 11 units
├── qwbe.config.json            gate roots and caps
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── cubes/
│   └── invoicing/              main cube, required
│       ├── index.ts            named `cube` export
│       ├── domain/             shared model, VAT arithmetic, date validation
│       ├── application/        ports, idempotency, service composition
│       ├── contracts/          schemas and host-facing seams
│       ├── parties/            CUI/CNP, counties and sectors for every party
│       ├── customers/          saved customers, their table and baseline
│       ├── catalog/            saved products and services, their table and baseline
│       ├── issuer/             issuer profile, branding, VAT and baseline
│       ├── drafts/             authoring and draft editing
│       ├── issuance/           document series, numbered invoices and proformas
│       ├── corrections/        storno documents
│       ├── documents/          rendered artifacts
│       ├── payments/           plugin: payment records and derived payment status
│       └── efactura/           plugin: RO e-Factura UBL, CIUS-RO limits, EN 16931 validation
├── kernel/                     kernel and adapters
│   ├── config.ts, failure-log.ts
│   ├── http/                   server, security headers, readiness, API docs
│   ├── auth/                   credentials, browser session, login throttle
│   ├── api/                    HttpApi contract, schemas, handlers
│   ├── storage/                PostgreSQL pool and store, row mappers, migration runner, schema fingerprint
│   ├── documents/              PDF renderer, artifact store and recovery, fonts
│   ├── efactura/               host mapping into the e-Factura plugin
│   ├── ops/                    CLI, backup, restore
│   └── parity/                 SQLite baseline fixtures for the PostgreSQL schema gate
├── frontend/                   browser UI: Next App Router, BFF under /api/qwbe
├── bin/                        CLI entry point and container command
├── probes/                     package, persistence, gate, and decoupling checks
├── scripts/                    fixtures and local helpers
└── docs/                       development, release, e-Factura, VAT treatment
```

The e-Factura mappers stay in `kernel/efactura/` as a host adapter, because the `efactura`
plugin's 40,000-character unit budget has no room for them (section 10); the PDF renderer
stays in `kernel/documents/` because it needs the filesystem and fonts. Kernel code depends only on the cubes' `index.ts` and `contracts/`;
cube code never imports the kernel.

Tests are colocated with what they exercise. Do not create empty directories or placeholder abstractions.

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
4. Resolved: the application owns its persistence (PostgreSQL 16 since T-1480, SQLite
   before it) and the mother installs nothing. A connected mother would only call the API
   as an external client (section 19); invoicing data never moves into its database.
5. Durable e-invoice submission workflow.
6. API-only operation versus the selected React + Effect UI adapter.
7. Resolved (T-1876): distribution shape is a plugin pack, one root `qwbe-package.json`
   with `kind: "plugin"` and every unit in `cubes` (section 13), without claiming
   `qwbe-core/package` compatibility.
8. Resolved: mounting into the mother and identity rebinding are outside the direction;
   no recursive canonical identity contract is pursued (section 9).
9. Which domains become child cubes, based on real ownership/lifecycle and size evidence.
10. Resolved: no mandatory dependency on `qwbe-core`. Shapes are copied and declared
    locally; nothing is imported from it.

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

Historical record, not normative. It predates the T-1876 direction; where it mentions installation, mounted operation, or open decision 10, sections 1, 3, 13, and 16 prevail.

Reviewed on 2 September 2026 after the mother's `main` moved from `987e11b` to `a98d9ef` (98 commits, tickets QWB-40 to QWB-48). What the mother changed and where this repository stands:

| Mother change | Ticket | Invoicing status |
|---|---|---|
| Shared package contract checker, `qwbe-core/package`, `docs/package-contract.md` | QWB-40 | Not run: the `kind: "cube"` shape is outside the plugin-pack layout the checker requires (one root `qwbe-package.json` with a `cubes` array). Own gates cover manifest shape, size, tests, boundaries, but not the `imports-internal` and `cube-builtins` rules the mother enforces. |
| Per-cube field metadata, `version` drift gate, `fields`, `relations`, `searchable` | QWB-41 | Not applicable yet: the cube declares no `entity` and no HTTP handlers. Declare `version` once the cube serves an entity. |
| External frontend auth: `QWBE_ALLOWED_ORIGINS`, CORS allowlist, httpOnly cookie through a proxy, 7-day token | QWB-42 | Aligned in spirit: this repository's kernel already keeps the token out of the browser behind an HttpOnly `SameSite=Strict` cookie. Session length differs (30 days here, 7 in the mother); not a contract. |
| One Postgres, one schema per cube, NOLOGIN role per cube, QWBE mother kernel outbox, SQLite removed | QWB-43, QWB-44 | Intentionally separate: since T-1480 standalone persists in its own PostgreSQL 16 database, one `public` schema owned by the application role, with relational tables and triggers. The schema-per-cube layout and the NOLOGIN role per cube are deliberately **not** adopted. Confirmed future mother integration is an external app/sidecar for installation/authentication, not direct persistence in mother Postgres; the integration is not implemented. |
| `usesBatch` raw-SQL capability (declared, outbox-exempt) | QWB-45 | Not usable as an escape: the role has no `CREATE`, so DDL is refused. |
| Custom field values under the reserved `custom` key of a row body | QWB-46 | No impact on relational tables. `custom` becomes a reserved column name if the cube ever moves to the six-operation store. |
| Installer strips a pack's top-level `frontend/`, `dist/`, `build/` | QWB-48 | No impact: the UI lives in `frontend/`, outside the packaged cubes. Future external-app integration remains unimplemented. |
| Size caps unchanged at 6,000 / 40,000 / 15 | - | Aligned on 5 September 2026: `qwbe.config.json` is back at 6,000 / 40,000 / 15 after the cube was split into component cubes (registry, drafts, issuance, corrections) and the three files still over 6,000 were cut. Section 10. |

Pre-existing gaps that the pull did not create but that a mounted install would hit first: `create()` returns `handlers: {}`, so the cube serves no HTTP surface under the mother (every endpoint lives in `kernel/api/api.ts`); `CurrentOrganization` is still a standalone-only contract (section 4); `qwbe-core` is still `0.0.0` and private (open decision 10).

## 19. Future mother contract

Text only; nothing here is implemented. It states what an adapter must satisfy before a
mother may call this application. A valid signature alone is not enough.

- **Issuer and audience.** `iss` matches one configured issuer exactly; `aud` matches
  exactly the audience dedicated to this installation's API. Accepted algorithms are an
  explicit allowlist; `none` and algorithm switching are refused.
- **Identity.** The external actor is the pair `(iss, sub)`. `username` is for display only
  and never links or selects an account.
- **Validity.** `exp`, `iat`, and `nbf` are required; the maximum lifetime is short and the
  clock-skew tolerance is limited to seconds.
- **Keys.** Trusted keys are configured explicitly and selected by `kid`; rotation uses a
  bounded overlap, and a revoked key is refused. The key URL is never taken from the token
  (`jku`, `x5u`, and embedded `jwk` are ignored).
- **Organization.** The organization claim names an external organization; the kernel maps
  it to a local organization and verifies that the actor has access to it. No client header
  or parameter overrides the claim; switching organizations needs a new token.
- **Authorization.** Grants are local and checked on every operation and resource. Roles
  declared by the mother never become local permissions automatically.
- **Transport.** HTTPS only. The token never appears in a URL or a log. Calls come from the
  mother's BFF (server to server), not from a browser.
- **Replay.** A bearer token is reusable until `exp`; `jti` alone does not prevent that.
  The remaining exposure is bounded by the short lifetime. If a one-time assertion exchanged
  for a session is chosen later, the assertion is consumed once. Idempotency keys on fiscal
  operations do not replace token protection.
- **Revocation and audit.** A disabled user, a withdrawn membership, or a compromised token
  stops access within a stated bound. Audit records identify the external actor by
  `(iss, sub)`.
- **Entry point.** A new `RequestAuthenticator` (`kernel/auth/auth.ts`) producing the same
  `RequestContext` (identity plus organization). The standalone login, API token, and
  browser session stay untouched.

Current limits that block it today:

- `kernel/auth/auth.ts` yields one principal, `kernel-owner`, with fixed permissions and the
  configured organization; there is no multi-user authorization yet;
- the BFF refuses the `Authorization` header (`frontend/src/lib/server/proxy-headers.ts`),
  and the session endpoint is cookie-only. Neither is a route for a mother caller.
