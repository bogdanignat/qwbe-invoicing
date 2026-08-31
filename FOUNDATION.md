# QWBE Invoicing Foundation

Status: architecture baseline before implementation  
Source snapshot: QWBE mother repository at `987e11b`  
Package manager: pnpm  
Runtime: Node.js + TypeScript + **Effect 3.x as primary runtime** (`effect`, `@effect/platform`, `@effect/platform-node`) — all cube application logic, host capabilities (Clock, Store, IdGenerator, Auth), and HTTP handling are modelled as `Effect`
UI: framework-free HTML/CSS/ES modules served by the standalone host; API-first — every cube use-case has a corresponding authenticated HTTP API endpoint, and the UI contains no fiscal business logic

## 1. Purpose

Build an invoicing application that:

- runs as a useful standalone application;
- is itself a QWBE cube;
- can later be mounted below a mother cube;
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

## 3. Two hosts, one application core

### Standalone mode

```text
standalone host
├── authentication adapter
├── account and organization adapters
└── invoicing cube
```

### Mounted mode

```text
mother runtime
├── global authentication
├── global accounts and organizations
└── invoicing cube
```

The invoicing cube depends on host-provided contracts. It must not detect which host is running it.

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
invoicing:payment.record
invoicing:settings.manage
```

Names are provisional until use cases are written. In standalone mode the current manifest must use the literal `invoicing:*` prefix. The same static declarations become invalid if the cube is mounted as `<mother>/invoicing`, because current validation requires the full mounted identity as prefix and offers no rebinding hook. No-rewrite mounting therefore requires either a definition/packaging factory that materializes identity-derived permissions, commands, events, routes, stores, and entity references, or a future kernel identity contract. Business logic must not treat `invoicing:*` as permanently canonical.

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

The current intended public boundary is exposed under names such as `qwbe-core/auth`, `qwbe-core/cube`, and `qwbe-core/permissions`. It is not yet a released compatibility guarantee: `qwbe-core` is private and version `0.0.0`. External consumption requires a versioned published package or an explicit compatibility artifact. The invoicing cube must never import mother kernel internals or sibling cube implementations.

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

Each cube owns its tables and receives a store restricted to those tables. Another cube's data is never read through its SQLite file.

For the first invoicing slice, likely owned concepts include:

- invoice drafts and issued invoice snapshots;
- invoice lines;
- numbering sequences;
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

Those operations require durable state, idempotency, an audit trail, and resumable effects. A transactional outbox or workflow journal must be designed when that slice starts.

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

Therefore mounting `invoicing` below a mother cube without source changes requires a mother-kernel evolution toward arbitrary identity paths and identity-derived declarations.

There is a second blocker: current hierarchy makes the parent directory the install/uninstall unit. A separately shipped child cannot be added below an already installed mother without modifying the mother's directory, which conflicts with the installation invariant. Future integration needs an explicit contributed-child or mount-point contract; current parent/child nesting alone cannot satisfy this repository's delivery goal.

Until both contracts exist, this repository remains standalone and avoids coupling to the temporary two-segment grammar.

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

The current QWBE `unitDirs` discovers only top-level cube directories and recursively counts their descendants. A nested child cube is therefore included in the parent's measured unit rather than measured as an independent recursive unit.

This repository must have a native size/test gate from its first implementation commit; the mother scripts cannot discover the standalone layout correctly. Configure the invoicing cube root explicitly, include all production code it owns, exclude standalone-host code and tests from the cube size, and add gate self-tests proving that an oversized or testless cube fails.

The scanner must understand recursive cube roots before child cubes are introduced. Each cube is measured as its own unit while a parent's own size excludes source owned by child-cube directories. Otherwise splitting into a legitimate child cannot reduce the parent's unit measurement.

Sources: QWBE `qwbe.config.json`, `probes/sizecaps.mjs`, and `probes/size-lib.mjs`.

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

The install artifact and authoring repository are different boundaries. A packaging allowlist must prove exactly what is emitted. Note that the current mother source filter does not exclude `pnpm-lock.yaml`, TypeScript tests, or a plural `tests/` directory reliably; our artifact builder must exclude them itself rather than trusting the mother filter.

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

- generic JSON storage without typed schema migrations;
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
4. SQLite transaction/outbox strategy.
5. Durable e-invoice submission workflow.
6. API-only operation versus a non-React UI technology.
7. Distribution shape: one cube package or a plugin delivering a cube tree.
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
