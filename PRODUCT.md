# QWBE Invoicing Product Scope

Status: product baseline; T-1069 implemented
Jurisdiction: Romania  
Last researched: 2026-08-30  
Mother alignment reviewed: 2026-09-02 against QWBE `a98d9ef` (see `FOUNDATION.md` section 18)
Architecture companion: [`FOUNDATION.md`](./FOUNDATION.md)

## 1. Product direction

QWBE Invoicing is a self-hosted invoicing application that:

- runs as a useful standalone product;
- can later be installed as a QWBE cube;
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
- structured address: country, county/region, city, postal code, street;
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

Legal entities require a valid Romanian CUI/CIF. For natural persons, CNP is
optional and is requested or stored only when the transaction and legal obligation
require it. Personal data is otherwise kept to the minimum necessary.

### 3.3 Numbering sequences

- separately configured invoice and proforma series;
- sequential and unique numbers within an explicit scope;
- recommended scope: issuer, fiscal year, document type, and series;
- atomic allocation from the applicable document-type sequence when an invoice or
  proforma is issued;
- drafts do not consume invoice or proforma numbers;
- every invoice draft selects one configured invoice series, while proforma issuance
  explicitly selects a configured proforma series;
- an allocated invoice or proforma number is never silently reused;
- gaps, abandoned allocations, and voided numbers remain explainable in the audit
  trail.

The database must enforce uniqueness. UI validation alone is insufficient.

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

Invoice lines can always be entered and edited manually. A product or service
catalog may prefill line data later, but it is never required for authoring.

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

`dueDate` is nullable on drafts, proformas, and issued invoices. Absence of a due
date is preserved through proforma conversion and invoice issuance; it never makes
an unpaid or partially paid invoice overdue by date alone.

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
- secure HttpOnly cookie sessions and CSRF protection in the standalone host;
- TLS, secret management, rate limiting, and sensitive-log redaction;
- encrypted off-host backups and tested restore;
- data minimization and retention compatible with fiscal/accounting obligations.

No blockchain is required. Integrity, reproducible snapshots, hashes, access
controls, and an append-oriented audit history provide the required product trail.

## 4. Additional document workflows

### Proforma

Implemented in T-1069. A proforma is an immutable, numbered non-fiscal commercial
snapshot emitted directly from authored content or from an optional saved draft. It uses a separately configured
proforma series and sequence scope; its number is never reused and never consumes an
invoice number. It can be listed, opened in detail, and rendered/downloaded as a PDF
that conspicuously says `DOCUMENT NEFISCAL`. Invoice issuance is allowed exactly once
and copies the preserved snapshot directly into a numbered immutable fiscal document.

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

The commercial invoice model preserves the information needed later by EN 16931 and
the Romanian CIUS profile:

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
├── migrate   one-shot command from the same image
├── data      persistent SQLite and document volume (standalone host only, see below)
└── proxy     optional Caddy profile for TLS
```

SQLite is the standalone host's persistence. This remains an intentional deployment
choice even though the QWBE mother runs Postgres. The confirmed future integration
direction is an external application/sidecar: the mother may provide installation
and authentication integration, while invoicing data remains owned by this
application in SQLite. This repository does not require a Postgres persistence
adapter and does not store invoicing data in the mother's Postgres database. Mother
integration itself is not implemented.

Deployment requirements:

- no database or application port exposed unnecessarily;
- persistent named volume or explicit bind mount;
- separate liveness and readiness checks;
- readiness verifies storage access and current migration version;
- migration failure prevents application startup;
- secrets are mounted from files and never baked into the image;
- versioned images are pinned by release and, for production, digest;
- releases target `linux/amd64` and `linux/arm64`;
- backup and restore include the SQLite databases plus invoice and proforma artifact
  metadata and files; the operator runbook separately protects configuration, exact
  image digests, and recovery secrets;
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

There are two canonical runtime contexts and one optional convenience tool:

| Artifact | Purpose |
|---|---|
| Docker image + Compose bundle | Standalone self-hosted application |
| `cube/invoicing/` package | Installation into a compatible QWBE runtime |
| npm CLI, later | Thin installer/operator wrapper around Docker and Compose |

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

- pin Node, pnpm, TypeScript, **Effect 3.x** (`effect`, `@effect/platform`, `@effect/platform-node`) and platform dependencies — Effect is the application runtime;
- create strict TypeScript, test, lint, size, and boundary gates;
- define organization, identity, store, clock, ID, and rendering ports as `Effect` capabilities;
- define observable domain failures as typed `Effect` failures;
- create package allowlist and standalone composition root (every use-case gets an `Effect`-based HTTP endpoint);
- add Docker build and Compose development baseline.

### Phase 1 — invoice core

- money, quantity, tax, address, and identifier value objects;
- issuer/customer snapshots;
- invoice draft aggregate, saved-customer or one-time-buyer authoring, and deterministic totals;
- numbering sequence;
- atomic issuance use case as `Effect`;
- SQLite schema and migrations;
- authenticated `Effect`-based HTTP API for the first vertical slice (every operation has `GET`/`POST`/`PUT` endpoint).

### Phase 2 — usable standalone product

- React 19 + TypeScript UI styled with Tailwind CSS 4, built with Vite and served by the standalone host; browser I/O, cancellation, concurrency and typed failures run through `Effect`, with TanStack Query as the React server-state adapter;
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
- exact cube artifact and compatibility checks against a versioned QWBE public
  contract, including the shared `qwbe-core/package` checker (QWB-40) once the
  package shape can be judged by it.

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
4. Resolved: React 19 + TypeScript + Tailwind CSS 4, Vite-built, same-origin and API-first. Effect is the browser runtime for HTTP effects and typed failures; TanStack Query bridges Effect programs into React server state. The standalone host exchanges the local API token for a revocable, opaque 30-day session persisted server-side and referenced by an HttpOnly `SameSite=Strict` cookie. The browser keeps only the per-session CSRF token in Effect memory, while direct API clients may continue to use bearer authentication.
5. What retention policy and backup targets are promised to operators?
6. Which public, versioned QWBE contracts replace the current private `0.0.0`
   compatibility snapshot?
7. Resolved: standalone remains SQLite. Intended future mother integration is an
   external application/sidecar for installation and authentication; invoicing data
   does not move into the mother's Postgres database. The integration contract and
   packaging are still unimplemented.
8. Package shape: keep the `kind: "cube"` package or reshape into a plugin pack
   (`cubes: ["invoicing", "invoicing/documents"]`) so the mother's shared checker and
   hierarchy rule apply.

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
