# QWBE Invoicing Product Scope

Status: product baseline; T-1069 implemented
Jurisdiction: Romania  
Last researched: 2026-08-30  
Mother alignment reviewed: 2026-09-02 against QWBE `a98d9ef` (historical, `FOUNDATION.md` section 18); direction since T-1876 in `FOUNDATION.md` sections 1, 3 and 13
Architecture companion: [`FOUNDATION.md`](./FOUNDATION.md)

## 1. Product direction

QWBE Invoicing is a self-hosted invoicing application that:

- runs as a useful standalone product;
- is shaped as one QWBE plugin pack, `invoicing` with `payments`, `efactura` and
  `company-lookup` as optional plugins (`required: false`, active by default; `QWBE_PLUGINS` switches them off
  at startup, and a plugin that is off keeps its data), while the QWBE mother installs nothing;
- is distributed primarily as versioned Docker images and a Docker Compose bundle;
- issues and preserves Romanian invoices without implementing direct ANAF transport in the first release;
- keeps the data model compatible with a later RO e-Factura workflow;
- treats issued invoices as immutable legal snapshots.

The first release targets a single self-hosted installation. All business data is
organization-scoped so that support for multiple legal entities does not require a
domain rewrite. The exact first-release organization limit must be confirmed before
the standalone account and organization adapters are implemented.

The first-release jurisdiction and currency are intentionally fixed to Romania (`RO`)
and Romanian leu (`RON`). Foreign issuers, foreign billing addresses, and invoices in
other document currencies are deferred; the broader currency fields in the domain
model are extension seams, not first-release UI capabilities.

## 2. Legal and product boundary

The application can create, issue, render, preserve, correct, and track payment of
invoices. It can also issue, render, preserve, list, and convert non-fiscal proformas.
The first release does **not** submit invoices to RO e-Factura.

This distinction must be visible in product documentation: taxpayers subject to
RO e-Factura obligations need another compliant channel for XML submission until
the ANAF integration is delivered. A generated PDF is a visual representation and
is not a substitute for the structured XML required by RO e-Factura.

This document is a product and engineering baseline, not legal or tax advice.
Special VAT regimes, cross-border transactions, cash-register rules, and sector
specific obligations require validation with an accountant or tax specialist.

## 3. MVP capabilities

### 3.1 Issuer configuration

The organization/legal entity profile supports:

- legal name;
- tax identifier and VAT identifier;
- trade register identifier;
- structured address: country, required ISO 3166-2 Romanian county, city, postal code, street;
  sector 1–6 is required for `RO-B` and prohibited for other counties;
- IBAN, bank, and payment instructions;
- VAT registration and applicable tax regime;
- contact details and logo;
- default currency, payment term, and invoice notes.

Contact details, bank data, and logo are useful product fields but are not universal
fiscal fields required on every invoice.

### 3.2 Customers

The customer register is optional convenience data, not a prerequisite for issuing
an invoice. Authoring supports both a saved customer and a one-time buyer entered
directly on the draft. Both legal entities and natural persons support:

- legal name or personal name;
- tax and VAT identifiers where applicable;
- structured billing address;
- optional delivery address;
- optional email, phone, and contact person;
- default currency, payment term, and notes.

Legal entities require a valid Romanian CUI/CIF stored as digits without `RO`,
and an explicit VAT registration flag. VAT identifiers are derived from that flag
and the canonical CUI, never inferred from user-entered prefixes. For natural persons,
VAT registration must be false and CNP is
optional and is requested or stored only when the transaction and legal obligation
require it. Personal data is otherwise kept to the minimum necessary. Invoices and
stornos to natural persons are still submitted to RO e-Factura (B2C, ANAF's `uploadb2c`);
without a CNP the XML carries `0000000000000` as the buyer identifier (BT-47).

### 3.3 Numbering sequences

- separately configured invoice and proforma series;
- sequential and unique numbers within an explicit scope: organization, numbering type
  (`invoice` or `proforma`) and series;
- numbering is continuous across years: a series never restarts at 1 on 1 January, so
  series + number identifies the document for its whole life (Codul fiscal art. 319
  alin. (20) lit. b); counting again from 1 means configuring a new series (for example
  `FCT2027`), which starts at 1;
- stornos are numbered from the invoice counter of the original invoice's series;
- the fiscal year is still recorded on every document, as information only: it plays no
  part in numbering, chronology or uniqueness;
- atomic allocation from the applicable document-type sequence when an invoice or
  proforma is issued;
- drafts do not consume invoice or proforma numbers;
- every invoice draft selects one active invoice series, while proforma issuance
  explicitly selects an active proforma series;
- a series cannot be deleted, since its documents refer to it, but it can be archived
  (`PUT /api/document-series/{documentType}/{series}/archived`, settings permission):
  it leaves every selection for new documents, its documents and counter stay as they
  are, and reactivating it continues the counter where it stopped. Archiving and
  reactivating are audited; asking for the state the series already has changes nothing;
- an archived series is refused (`409 document_series_archived`, no number taken) when a
  draft is created in it, an invoice or proforma is issued in it directly, a draft is
  issued as an invoice in it, a proforma is issued in it from a draft, or a proforma is
  converted into it; the series is read again in the issuing transaction. The archived
  series of a proforma being converted does not block its conversion into an active one;
- an open draft can change its invoice series to another active one of the same
  organization, so a draft left on an archived series is moved (or deleted) rather than
  stuck; its lines stay editable meanwhile, only its issuance waits for the move;
- the exception is the storno: it is always numbered in the series of the original
  invoice, archived or not;
- an allocated invoice or proforma number is never silently reused;
- gaps, abandoned allocations, and voided numbers remain explainable in the audit
  trail.

The database must enforce uniqueness. UI validation alone is insufficient. Each document
table carries a unique key on its scope and number; invoices and stornos live in two
tables, and uniqueness between them comes from the shared `invoice` counter, allocated in
the same serialized transaction that saves the document, not from a constraint.

### 3.4 Invoice drafts

A draft contains:

- issuer reference and a buyer snapshot, optionally linked to a saved customer;
- issue date, optional due date, supply date, and tax-point date where applicable;
- document currency and tax currency;
- exchange rate, date, and source when required;
- contract, purchase-order, delivery, and preceding-document references;
- invoice lines;
- allowances, charges, and notes;
- payment terms and payment instructions.

Drafts remain editable and do not represent issued fiscal documents. Saving one is
optional: the authoring form can issue an invoice or immutable numbered proforma
directly, while a saved draft can still issue either document. A proforma can issue
exactly one invoice from its preserved snapshot; the invoice number is allocated in
that same atomic operation. No intermediate draft is required.

### 3.5 Invoice lines and taxes

Each line supports:

- item name and description;
- quantity and coded unit of measure;
- unit price excluding VAT;
- line-level allowance or charge;
- taxable amount;
- tax category and tax rate;
- tax exemption or reverse-charge reason and legal basis where applicable;
- tax amount and line total.

Invoice lines can always be entered and edited manually. The optional product or
service preset list stores only a description and unit price; selecting a preset
copies those values into an editable line. It has no stock, SKU, price-list, or live
product-to-document relation and is never required for authoring.

VAT is modeled per line and summarized per tax category/rate. Tax rates are
effective-dated configuration, not hardcoded constants.

The calculation engine must define deterministic decimal arithmetic and rounding
rules. It must preserve both document-currency and RON tax amounts when the fiscal
rules require them.

### 3.6 Mandatory issued-invoice content

Depending on the operation and tax regime, an issued invoice must preserve:

- sequential number and series;
- issue date;
- supply/service or advance-payment date when different;
- supplier legal name, address, and fiscal/VAT identifiers;
- customer legal name, address, and fiscal/VAT identifiers when applicable;
- description, nature, quantity, and unit price of goods or services;
- allowances and discounts not already included in the unit price;
- taxable amount by rate or exemption;
- VAT rate and VAT amount;
- document totals;
- required wording for exemption, reverse charge, VAT on collection, self-billing,
  margin schemes, intra-community supply, export, or other applicable regimes;
- reference to the original invoice when the document is a correction;
- fiscal representative details where applicable.

Due date, IBAN, bank, email, and phone are strongly recommended product fields but
are not universal mandatory elements in the standard invoice list.

`dueDate` is nullable on drafts and proformas. As a product choice satisfying the
due-date/payment-terms alternative, a positive invoice requires a due date before
number allocation, including direct issuance, draft issuance and proforma conversion.
No payment-terms field is introduced, and the API adds no date of its own. The editor
proposes one: an open draft saved without a due date opens with the issue date plus the saved
customer's payment term, else the organization's, and the reasons that block "Emite factura"
are listed under the button. The proposal is only saved with the draft. A proforma without a due date
can be converted to an editable draft first. Zero invoices remain exempt; corrections
retain their own rules. A null date never makes a document overdue by date alone.

### 3.7 Issuance and immutable snapshot

Issuance is one atomic use case:

1. validate the draft and organization authorization;
2. allocate the next series number;
3. calculate and freeze monetary and tax totals;
4. snapshot issuer, customer, lines, tax breakdown, and references;
5. persist the issued invoice and lifecycle event;
6. render and preserve its PDF representation.

After issuance, fiscal content cannot be edited or deleted. Later changes to the
customer or issuer register do not alter the issued snapshot.

The preserved representation records:

- generated PDF or storage object reference;
- SHA-256 hash;
- template version;
- generation timestamp;
- structured source snapshot;
- applicable retention metadata.

### 3.8 Payments

Payments are separate records and never mutate the issued invoice:

- amount and currency;
- payment date;
- method and external reference;
- allocation to one or more invoices;
- optional note and actor.

Derived payment states include unpaid, partially paid, paid, overdue, and
overpaid/credit where supported. Overpayment is accepted deliberately so the ledger can represent excess bank receipts and concurrent imports instead of discarding them. The standard UI closes its payment form at zero remaining balance, while API/import calls may still produce the explicit `overpaid` state.

### 3.9 Corrections

An issued invoice is corrected through a new fiscal document, not destructive
editing:

- credit note or debit/correction document;
- explicit reference to the original invoice;
- reason for correction;
- line and tax adjustments;
- immutable link between the original and correcting documents.

The product may use the familiar label `storno`, but the domain stores the precise
correction relationship and amounts.

### 3.10 Audit, authorization, and retention

The application records durable lifecycle events for creation, issuance, delivery,
payment, correction, and administrative changes. Each event includes actor, time,
organization, action, target, and reason where applicable.

Required protections include:

- authenticated access;
- organization- and resource-level authorization;
- explicit permissions for reading, drafting, issuing, correcting, recording
  payments, and changing settings;
- secure HttpOnly cookie sessions and CSRF protection in the kernel;
- TLS, secret management, rate limiting, and sensitive-log redaction;
- encrypted off-host backups and tested restore;
- data minimization and retention compatible with fiscal/accounting obligations.

No blockchain is required. Integrity, reproducible snapshots, hashes, access
controls, and an append-oriented audit history provide the required product trail.

### 3.11 Company details from a CUI or a name (optional)

Typing a company's details by hand is slow and error-prone. With the `company-lookup`
plugin, the customer form, the one-time buyer on a document and the issuer settings
propose them from the CUI:

- **Integrations** (Integrări, its own menu entry) has one switch per provider: **ANAF** (free, no key, CUI
  only) and **openapi.ro** (needs the user's openapi.ro key, and also suggests companies
  by name). At most one is on; switching one on switches the other off; both may be off.
  openapi.ro cannot be switched on before its key is saved, and deleting the key switches
  it off. The key is write-only: once saved, only its last four characters are shown, and it
  can be replaced or deleted, never read back. Addresses and limits are fixed, not settings.
- A lookup starts on its own, for companies only (not natural persons), once the CUI has at
  least 4 digits and a valid check digit. With openapi.ro, typing at least 6 letters in the
  name offers matching companies; picking one looks its CUI up.
- The answer is a proposal, never an edit: a card says “Am găsit: name, county” with a
  **Completează** button, and the form changes only on that click. It warns when the
  company is struck off or declared fiscally inactive.
- ANAF gives a structured address (county, Bucharest sector, locality, street and number,
  postal code), which fills the address fields. openapi.ro gives one address line: only the
  county and postal code are filled, the line is shown for the user to copy the rest.
- A customer gets the provider's VAT status as a suggested, editable checkbox. The issuer
  gets the trade register number too, but its VAT regime is never changed from a lookup; the
  provider's VAT status is shown only as information.
- There is no request quota of our own. When openapi.ro says its quota is used up, the form
  says so and stays usable by hand. An answer is kept in memory for 24 hours (until a restart), so asking again does not
  spend a request. With the plugin off, or with no provider switched on, no request leaves
  the installation and the forms show nothing extra.

## 4. Additional document workflows

### Proforma

Implemented in T-1069. A proforma is an immutable, numbered non-fiscal commercial
snapshot emitted directly from authored content or from an optional saved draft. It uses a separately configured
proforma series and sequence scope; its number is never reused and never consumes an
invoice number. It can be listed, opened in detail, and rendered/downloaded as a PDF
that conspicuously says `DOCUMENT NEFISCAL`. Invoice issuance is allowed exactly once
and copies the preserved snapshot directly into a numbered immutable fiscal document.

A proforma issued for a saved customer (directly, or from a draft linked to one)
keeps that customer's id next to its frozen buyer snapshot, as immutably as the rest
of it; a one-time buyer leaves it empty. Converting it into an editable draft re-reads
the customer in the same transaction: while it still exists in the organization and is
not deleted, the draft is linked to it (with the proforma's buyer copy), so a draft
without a due date gets the customer's payment term proposed, or the organization's
when the customer has none. A customer deleted since then leaves a one-time buyer, as
before. A proforma with a due date keeps its own term on the draft. Proformas never
block deleting a customer, but the linked draft does while it is open, like any open
draft. Direct invoice issuance from a proforma is unchanged.

A proforma has no RO e-Factura submission state, payment ledger, overdue state, or
invoice-correction/storno semantics. Proforma delivery currently means downloadable
PDF, not email.

The remaining document types are outside the implemented scope:

### Simplified invoice

Deferred. Eligibility depends on transaction value and legal conditions; it must
not be implemented as an unrestricted short invoice template.

### Delivery note

Deferred. It is a distinct goods-movement document and is not universally required.

### Receipt and fiscal receipt

Deferred. Cash collection and fiscal cash-register obligations depend on activity,
payment channel, and applicable exceptions. An invoice does not universally replace
a fiscal receipt.

## 5. RO e-Factura readiness without ANAF integration

The invoice owns immutable fiscal facts exposed through its public document contract;
the future e-Factura cube consumes those facts, not private tables or current profiles.
County/sector, canonical CUI and explicit party VAT registration now round-trip through
registry, drafts, issued snapshots, proformas and full corrections. VAT treatment is
explicit and frozen: S for positive standard/reduced rates, E/0.00 with legal reason
text generated automatically for the supported non-VAT/Article 310 workflow, without
asking for a second confirmation after the issuer registration setting. Other VAT
categories/exemptions remain unsupported. This is not complete EN 16931/CIUS-RO
readiness: no XML exporter or full XML/business-rule validation is included yet.
The scope and inspected rule evidence are recorded in [VAT_TREATMENT.md](docs/VAT_TREATMENT.md).

The target commercial invoice model must eventually preserve the information needed
by EN 16931 and the Romanian CIUS profile; this list is a target, not a claim that all
fields are currently implemented:

- invoice identifier, issue date, and invoice type code;
- seller and buyer names, addresses, tax identifiers, and electronic endpoints;
- document currency and VAT accounting currency;
- payment means, due date, and remittance information;
- order, contract, delivery, and preceding-invoice references;
- allowances and charges;
- coded units, quantities, item descriptions, and unit prices;
- tax category, rate, exemption reason, taxable amount, and VAT amount;
- legal monetary totals;
- attachments and supporting-document references.

ANAF transport will be a separate durable workflow with its own records:

```text
issued invoice
  -> XML generation
  -> local schema/business-rule validation
  -> submission
  -> status polling
  -> response download
  -> accepted or rejected
```

The future transmission record needs profile/version, XML hash, idempotency key,
submission identifier, timestamps, status, validation errors, response hash, and
retry metadata. `submitted` never means `accepted`. The in-memory QWBE event bus is
not the source of truth for this workflow.

The exact current RO CIUS version, ANAF schemas, supported codes, credentials, and
submission obligations must be researched again immediately before that integration.

## 6. Initial lifecycle

```text
authored document ─┬─> optional editable draft ─┬─> issued invoice
                  │                            └─> immutable numbered proforma
                  ├─> issued invoice
                  └─> immutable numbered proforma ─> exactly-once issued invoice

issued invoice -> delivered -> partially_paid -> paid / overdue / corrected
```

`Draft` is editable. Every state from `issued` onward refers to an immutable fiscal
snapshot plus separate lifecycle/payment/correction records. A proforma is immutable
but non-fiscal and has none of the invoice payment, overdue, correction, or e-Factura
states.

## 7. Canonical deployment

The standalone product is installed through a versioned Docker Compose bundle:

```text
Docker Compose
├── app       versioned multi-architecture QWBE Invoicing image
├── db        PostgreSQL 16, pinned by digest, cluster initialised with the C locale
├── migrate   one-shot command from the same image, gated on `db` being healthy
├── data      persistent document (PDF) volume, plus a separate cluster volume
│             and a separate backup staging volume
└── proxy     optional Caddy profile for TLS
```

PostgreSQL 16 is the kernel's persistence, in a container this bundle runs
and on a volume it owns. It is an intentional deployment choice rather than
convergence on the mother: the mother installs nothing, and invoicing data stays owned
by this application. The same engine on both sides is not the same database — this
bundle does not adopt the mother's schema-per-cube layout or its NOLOGIN role per cube,
does not require a shared database topology, and does not store invoicing data in the
mother's Postgres. A future mother could only call the API as an external client
(`FOUNDATION.md` section 19); that is not implemented.

The database port is never published; the application role owns the one `public`
schema it migrates; and both credentials are files the operator creates, read through
`POSTGRES_PASSWORD_FILE` and `PGPASSWORD_FILE`. `PGPASSWORD` is never set, so the
password reaches no child process and no `docker inspect` output. In `compose.prod.yaml`
neither secret has a default: the stack refuses to start rather than come up on a
guessable credential.

Deployment requirements:

- no database or application port exposed unnecessarily;
- persistent named volume or explicit bind mount;
- separate liveness and readiness checks;
- readiness verifies storage access and current migration version;
- migration failure prevents application startup;
- secrets are mounted from files and never baked into the image;
- versioned images are pinned by release and, for production, digest;
- releases target `linux/amd64` and `linux/arm64`;
- backup and restore cover the whole database plus invoice and proforma artifact
  metadata and files, as one archive with a manifest and SHA-256 digests; live browser
  sessions are deliberately excluded (the table is dumped without its rows, so the
  restored schema does not drift); the operator runbook separately protects
  configuration, exact image digests, and recovery secrets;
- backup and restore require the application to be stopped, and enforce it with a
  maintenance lock rather than with documentation; restore only ever writes into a
  fresh, empty database and an empty artifact tree, and never deletes anything;
- normal upgrade documentation never uses `docker compose down -v`.

Recommended image location:

```text
ghcr.io/<organization>/qwbe-invoicing:<version>
```

Docker Hub may mirror the image for discoverability. GHCR is the canonical registry.

Each release should contain:

```text
compose.yaml
.env.example
Caddyfile.example
image-digests.txt
install, upgrade, backup, restore, and rollback documentation
optional offline image bundle
```

## 8. Distribution artifacts

There is one canonical runtime context and one optional convenience tool:

| Artifact | Purpose |
|---|---|
| Docker image + Compose bundle | Standalone self-hosted application |
| npm CLI, later | Thin installer/operator wrapper around Docker and Compose |

The plugin pack manifest (`qwbe-package.json`) describes the package structure for this
repository's gates; it is not an artifact installed into a QWBE runtime.

`npm install` is not the runtime deployment mechanism. Requiring Node and npm on a
Docker host would duplicate the runtime contract. A later CLI may expose commands
such as `install`, `doctor`, `backup`, `restore`, and `upgrade`, but the application
continues to run from immutable Docker images.

The image itself should also expose operational commands so npm is never required:

```text
qwbe-invoicing migrate
qwbe-invoicing bootstrap-admin
qwbe-invoicing doctor
qwbe-invoicing backup
qwbe-invoicing restore
```

State-changing commands must be idempotent where possible, support explicit apply
guards, avoid secrets in output, report stable exit codes, and document partial
failure and recovery behavior.

## 9. First implementation slice

The first complete vertical slice is:

```text
configure issuer
  -> select a saved customer or enter a one-time buyer
  -> create and edit a draft
  -> add, edit, and remove manual taxed lines
  -> issue with series and number
  -> read the immutable issued invoice
```

Required tests precede implementation and cover:

- decimal calculation and rounding;
- validation of mandatory invoice data;
- atomic sequence allocation and duplicate refusal;
- issuance rollback when any step fails;
- prohibition of issued-invoice mutation;
- issuer and customer snapshot preservation;
- organization isolation and permission refusal;
- persistence after process restart;
- migration compatibility;
- boundary and size gates from `FOUNDATION.md`.

PDF rendering, payment recording, correction documents, and the proforma workflow
are implemented. Direct ANAF integration begins only after the invoice core and
durable workflow seam are stable.

## 10. Initial delivery phases

### Phase 0 — repository and contracts

- pin Node, pnpm, TypeScript, **Effect 3.x** (`effect`, `@effect/platform`) and platform dependencies — Effect is the application runtime;
- create strict TypeScript, test, lint, size, and boundary gates;
- define organization, identity, store, clock, ID, and rendering ports as `Effect` capabilities;
- define observable domain failures as typed `Effect` failures;
- create package allowlist and kernel composition root (every use-case gets an `Effect`-based HTTP endpoint);
- add Docker build and Compose development baseline.

### Phase 1 — invoice core

- money, quantity, tax, address, and identifier value objects;
- issuer/customer snapshots;
- invoice draft aggregate, saved-customer or one-time-buyer authoring, and deterministic totals;
- numbering sequence;
- atomic issuance use case as `Effect`;
- relational schema and migrations;
- authenticated `Effect`-based HTTP API for the first vertical slice (every operation has `GET`/`POST`/`PUT` endpoint).

### Phase 2 — usable standalone product

- React 19 + TypeScript UI styled with Tailwind CSS 4: a Vite single-page application with TanStack Router (`frontend/`), served by the kernel on the same origin as `/api`, with TanStack Query as the React server-state adapter;
- PDF rendering and preserved artifacts;
- payment recording and status calculation;
- correction documents;
- PDF download delivery; email remains future work;
- first-run bootstrap, backup, restore, health, and operator documentation.

### Phase 3 — release hardening

- multi-architecture image publication;
- versioned production Compose bundle and optional Caddy profile;
- migration and restore drills;
- security review and audit-log verification;
- local package contract checks (`FOUNDATION.md` section 13); compatibility with the
  `qwbe-core/package` checker is not claimed.

### Later — RO e-Factura

- current ANAF/RO CIUS research;
- deterministic XML mapping and validation;
- credential and authorization adapter;
- durable outbox/workflow journal;
- idempotent submit, poll, download, retry, and reconciliation;
- operational dashboard and failure recovery.

## 11. Open product decisions

The following decisions must be explicit before their relevant implementation:

1. Is the initial standalone product limited to one legal entity, or may one
   installation manage several?
2. Which VAT regimes are supported in the first public release beyond ordinary
   domestic VAT and non-VAT-registered issuers?
3. Resolved for the first usable release: delivery is PDF download. Email remains a
   future capability; proforma delivery specifically means download, not email.
4. Resolved (T-1910): React 19 + TypeScript + Tailwind CSS 4 in a single-page application
   built with Vite and routed with TanStack Router (file routes in `frontend/src/routes/`);
   TanStack Query holds React server state. One image: the kernel serves the build
   (`QWBE_UI_DIR`), the API under `/api/*` and the Swagger page (`GET /api`) on one origin,
   `PUBLIC_ORIGIN`, behind the operator's TLS proxy, and owns the whole public edge itself:
   `Host`/`Origin` pinning, CSRF, CSP and the request deadline. The kernel exchanges the
   local API token for a revocable, opaque 30-day session persisted server-side and
   referenced by an HttpOnly `SameSite=Strict` cookie scoped to `/api`. The browser keeps
   only the per-session CSRF token in memory. The Bearer API is off on the public listener
   unless `QWBE_BEARER_API=on`; the CLI inside the container is the operator's interface.

   Superseded decisions, kept as history: from T-1400 to T-1649 a Next.js App Router
   application (`frontend/`) ran next to the first Vite UI and replaced it at the T-1649
   cutover (2026-10-09). It was a second service and a second image, and reached the
   kernel only through a backend-for-frontend under `/api/qwbe/*` that held the session
   cookie, CSRF and `Origin` checks, while the kernel stayed internal. T-1910 removed it:
   a server-rendering framework bought nothing for a UI behind a login, and the second
   process doubled the edge that had to be secured, the images to pin and the self-host
   steps. Its guards moved into the kernel (T-1911) and the UI became a static Vite build
   the kernel serves (T-1912 to T-1914).
5. What retention policy and backup targets are promised to operators?
6. Resolved: no mandatory dependency on `qwbe-core`; shapes are copied and declared
   locally.
7. Resolved: standalone owns its own database — PostgreSQL 16 since T-1480, SQLite
   before it — and its own login. The mother installs and mounts nothing; invoicing
   data does not move into its database, and no shared topology is adopted. A future
   mother would call the API under `FOUNDATION.md` section 19, which is not implemented.
8. Resolved (T-1876): package shape is one plugin pack, a root `qwbe-package.json` with
   `kind: "plugin"` listing every unit, without claiming `qwbe-core/package` compatibility.

## 12. Primary references

- Romanian Fiscal Code, invoicing requirements, Article 319:  
  <https://legislatie.just.ro/Public/DetaliiDocumentAfis/171282>
- Council Directive 2006/112/EC, invoicing rules, Articles 226–247:  
  <https://eur-lex.europa.eu/legal-content/RO/TXT/HTML/?uri=CELEX:32006L0112>
- Directive 2014/55/EU on electronic invoicing in public procurement:  
  <https://eur-lex.europa.eu/legal-content/RO/TXT/?uri=CELEX:32014L0055>
- ANAF RO e-Factura documentation and services:  
  <https://www.anaf.ro/anaf/internet/ANAF/servicii_online/e_factura>
- GDPR, Regulation (EU) 2016/679:  
  <https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=ro>
- Docker volumes:  
  <https://docs.docker.com/engine/storage/volumes/>
- Docker Compose startup order and health dependencies:  
  <https://docs.docker.com/compose/how-tos/startup-order/>
- Docker multi-platform builds:  
  <https://docs.docker.com/build/building/multi-platform/>
- GitHub Container Registry:  
  <https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry>

Legislation and ANAF technical profiles change. Revalidate the relevant official
sources before each compliance-sensitive release.
