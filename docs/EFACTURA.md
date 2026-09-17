# e-Factura XML generation (T-1345)

Scope of this step: a pure generator that turns a frozen fiscal snapshot into
UBL 2.1 / CIUS-RO XML, plus the host mapping from the invoicing model and
synthetic fixtures for the official validator.

**Nothing is activated.** There is no API endpoint, no UI action, no migration
and no write to `eFacturaStatus`. Transport to the SPV stays in T-1346.

## Layout

| Unit | Role |
| --- | --- |
| `cube/efactura/contracts/document.ts` | `EFacturaDocument` — the normalized fiscal contract, every amount a decimal string, every value already positive |
| `cube/efactura/validation.ts` + `totals.ts`, `vat-rules.ts`, `vat-groups.ts` | the EN 16931 rules checkable without the official validator |
| `cube/efactura/cius-limits.ts` | the CIUS-RO length and occurrence limits, read from the official Schematron |
| `cube/efactura/xml.ts` | deterministic serializer: element order is array order, no mixed content, no unrepresentable characters |
| `cube/efactura/ubl.ts`, `ubl-party.ts` | the UBL document and party builders, in `xsd:sequence` order |
| `cube/efactura/profile.ts` | the CIUS-RO constants, injected rather than hard-coded |
| `standalone/efactura-mapper.ts` | the host translation from `IssuedInvoice` / `CorrectionDocument` |
| `cube/efactura/fixtures.test-support.ts` | the synthetic documents, all invented |

The generator never imports the invoicing cube, and the mapper is the only code
that knows both models. The cube re-states its own decimal arithmetic instead of
sharing invoicing's, because cubes may not import each other.

## What the local gate checks

Passing it does not mean a document is valid — only ANAF decides that. Failing
it means we would knowingly emit a broken document, so we refuse and name every
offending field at once.

- Identity and dates: BT-1, BT-2, BT-5 (RON only), BT-9, BT-25/26, BG-3.
- BR-RO-120: the buyer carries BT-47 and/or BT-48. Added after the validator
  returned it verbatim; see "What the validator said" below.
- BR-O-02: a document that is not subject to VAT states no VAT registration at
  all — neither BT-31 nor BT-48. Also returned verbatim by the validator.
- BR-CO-25: an invoice with a positive amount due needs a due date. This mirrors
  the product rule already enforced at issuance.
- Totals: BR-CO-10, BR-CO-13, BR-CO-14, BR-CO-15, BR-CO-16 — as strict
  equalities, because document allowances, charges and prepaid amounts are out
  of scope. BR-CO-17 recomputes each category's VAT with half-up rounding on
  scaled integers. One further check — that the breakdown's taxable amounts sum
  to BT-109 — carries no rule number on purpose: it follows from BR-CO-10 and
  BR-\*-08 without EN 16931 stating it, and a citation would invent a source.
- VAT categories: BR-S-01/05/08/10, BR-E-01/05/08/09/10, BR-O-01/05/08/09/10/11..14,
  BR-CO-18 (a document has at least one breakdown), BR-RO-L100, BR-RO-065.
- A VAT group is a category and a rate compared **as a number**: `21` and
  `21.00` are one group, not two. When a line's group is missing, the refusal
  cites BR-\*-01 only if the *category* is absent; a category present at another
  rate keeps that rule satisfied, so that message carries no rule number.
- Anything stated but empty is refused rather than dropped, for two different
  reasons. An optional element — an exemption code, a due date — is omitted by
  the renderer when blank, so it would satisfy a rule here and then be missing
  from the XML ANAF reads. A note is rendered unconditionally, so a blank one
  would instead be sent as `<cbc:Note></cbc:Note>`: a statement nobody made.
  Both are caller mistakes, and both are named before the document is built.
- BT-120 is measured the way XPath measures it: only space, tab, CR and LF
  collapse **or trim** (a no-break space is a character, at the ends as much as
  in the middle, which is why `String.trim` is not used), and the 100-character
  limit counts characters, not UTF-16 code units.
- Parties: ISO 3166-1 alpha-2 country and the seller identifiable by BT-31
  **or** BT-32. For a Romanian address the county is checked against the ISO
  3166-2:RO list copied from the Schematron rather than by shape (BR-RO-110):
  `RO-XX` looks like a county and is not one. BR-RO-100 then requires BT-37/
  BT-52 to be `SECTOR1`..`SECTOR6` whenever the county is `RO-B` — in Bucharest
  the sector is the city-level unit, and "București" is a rejection. The mapper
  never invents a sector for an address that lacks one: it is already required
  when the party is saved, and choosing one here would invent a fiscal fact.
- The CIUS-RO length and occurrence limits for everything we emit, in
  `cius-limits.ts`: BT-22 at most 300 characters each and at most twenty of them
  (BR-RO-L300, BR-RO-A020), item name 100, party name 200, street 150, city 50,
  post code 20, document and preceding-invoice number 200, and BR-RO-010 — a
  document number has to contain a digit, which the official validator checks
  before any fiscal rule. They are measured after `normalize-space` and in
  characters, and an offending text is refused rather than shortened: a
  truncated fiscal text is a statement the document never made. Limits for
  elements we do not emit are deliberately absent rather than written against
  nothing.

Deliberate omissions, each with a reason rather than an oversight:

- **BG-16 payment means.** An IBAN on the issuer profile is not evidence of the
  payment means agreed with the buyer, and BT-81 has no source in the snapshot.
  The contract carries no field for it either: it had one, unrendered, which
  made the shape promise an element the generator silently dropped — and got
  BT-85 wrong while doing so (it is the payment *account* name, not the bank's).
  `contracts/document.ts` records what it will need when a source exists.
- **A consumer without a CNP.** BR-RO-120 demands *an* identifier and the only
  one a private individual has is a CNP, which the product keeps optional. When
  the invoice carries one it is sent as BT-47; when it does not, or when the
  stored value fails its own check digit, `ANONYMOUS_BUYER_IDENTIFIER`
  (thirteen zeros) takes its place. The validator accepts both forms, so an
  invoice issued without a CNP is still sendable, and a malformed CNP — which
  would name the wrong person rather than nobody — is never exported.
- **BT-32 for the buyer.** It is a seller-only term. A buyer company without a
  VAT registration is named through BT-47 — its CUI — instead.
- **BT-49 electronic addresses.** Required by Peppol BIS, not by EN 16931 or
  CIUS-RO. If the validator asks for them, they come from a real source, not a
  synthesised one.

## What the validator said

First round, 2026-09-17, all six fixtures rejected. Two rejections were about
the fixtures, two were about the code.

`ERRIdentif` / *CUI cumparator incorect* — the validator checks the buyer CUI's
check digit before it runs any fiscal rule, so an invented identifier has to be
a structurally valid CUI or nothing downstream is exercised at all. The
fixtures now use CUIs that pass `isValidRomanianCui`.

BR-RO-120, verbatim:

> [BR-RO-120]-Identificatorul de înregistrare legala a Cumparatorului (BT-47)
> si/sau Identificatorul de TVA al Cumparatorului (BT-48) trebuie sa fie
> înscris.

This rejected the consumer invoice outright. There is no CIUS-RO-valid B2C
invoice without a buyer identifier, which is why a consumer now always carries
BT-47 — their CNP, or the anonymous placeholder when there is none.

BR-O-02, verbatim:

> [BR-O-02]-An Invoice that contains an Invoice line (BG-25) where the Invoiced
> item VAT category code (BT-151) is Not subject to VAT shall not contain the
> Seller VAT identifier (BT-31), the Seller tax representative VAT identifier
> (BT-63) or the Buyer VAT identifier (BT-48).

A real consequence for Article 310, not a fixture bug: if the `O` treatment is
adopted, an invoice from an Article 310 issuer must **not** carry the buyer's
VAT identifier, even when the buyer is VAT registered. The buyer keeps its
identity through BT-47.

The upload form offers exactly two standards: `FACT1` and `FCN` (credit notes).

Second round, same day, after fixing all four causes: **all eight fixtures
valid**, no assertion of any kind. That settles several things at once.

| Question | Answer |
| --- | --- |
| Are the profile constants right? | Yes — eight documents carrying exactly `DEFAULT_CIUS_RO_PROFILE` were accepted, including the omitted `UBLVersionID` and the `NOT_VAT` scheme for BT-32. |
| Is `SECTOR3` + `RO-B` the expected Bucharest form? | Yes. |
| Does BR-CO-25 apply to a credit note? | No — a credit note with no due date and no payment terms is valid. |
| What identifies a consumer? | Both a real CNP and the placeholder `0000000000000` are accepted, so the CNP is sent when the invoice has one and the placeholder stands in when it does not. |
| Can a buyer company without a VAT registration be named by BT-47 alone? | Yes. |
| Is Article 310 `E` or `O`? | **Both are accepted**, so the validator did not decide it. The product issues `O`; see below. |

## VAT category for Article 310 issuers: `O`, as ANAF recommends (T-1383)

`docs/VAT_TREATMENT.md` and migration 020 originally chose category **E** with
the Article 310 text in BT-120, recording that "no specific VATEX mapping for
Article 310 has been asserted".

ANAF asserts one. From
[Completare informații de interes referitoare la implementarea sistemului
național privind factura electronică RO e-Factura](https://static.anaf.ro/static/10/Anaf/Informatii_R/Complet_recom_tehnica_e-fact_apri2022_v1_060422.pdf)
(retrieved 2026-09-17):

> Pentru livrarea efectuată de persoane impozabile neînregistrate în scopuri de
> TVA, urmatoarea recomandare de completare este necesara:
> - codul categoriei de TVA (BT-95, BT-102, BT-118, BT-151) = O
> și
> - codul motivului scutirii de TVA (BT-121) = VATEX-EU-O (Not subject to VAT)

and, for BT-22:

> ... poate contine inclusiv o trimitere la aplicabilitatea ART. 310 - Regimul
> special de scutire pentru întreprinderile mici

The same document assigns **E + VATEX-EU-309** to a different case entirely: the
travel agents' margin scheme under article 309 of Directive 2006/112/EC.

The difference is structural, not cosmetic:

| | Former shape (E) | Shape issued today (O) |
| --- | --- | --- |
| BT-118 / BT-151 | `E` | `O` |
| BT-119 / BT-152 | `0.00`, present | **absent** |
| BT-121 | absent | `VATEX-EU-O` |
| Legal reference | BT-120 text | BT-22, as its own note |

**The validator did not settle this.** Both fixture 04 (`E`) and fixture 05
(`O`) were accepted without a single assertion, so the choice was a fiscal
interpretation and not a schema constraint. What settled it is the asymmetry in
the evidence: ANAF's own technical recommendation names `O` for this exact case
and `E` for a different one, and nothing in the repository's history cites a
source for `E`. Fixture 04 is therefore a shape the product no longer issues —
not a shape ANAF rejected.

The product now issues `O` end to end (T-1383). `VatCategoryCode` is `"S" | "O"`
in the invoicing model, the eight CHECK constraints in migration 020 accept the
Article 310 tuple only under `O`, and `E` is refused everywhere — by the domain
validator, by the database and by the web decoder — even when the rest of the
tuple is exactly right. The stored rate stays `0.00`, because the model requires
a rate and the tax due really is nothing; the **mapper** produces the absence of
BT-119/BT-152, which is a rule of the standard rather than a fact about the sale.

BR-O-02 propagates: an Article 310 invoice does not carry the buyer's VAT
identifier, even for a VAT-registered buyer, who is named by BT-47 instead.

BT-22 now carries up to two statements. The legal reference is mandatory for
this treatment and a correction reason is mandatory for a storno, so a document
that is both carries both — as **two notes**, the reference first. BT-22 repeats
in UBL (BG-1, up to twenty occurrences under BR-RO-A020) and CIUS-RO limits a
single occurrence to 300 characters (BR-RO-L300), so joining the two into one
text would make a mandatory legal reference eat into a mandatory storno reason.
Neither is dropped or truncated: the note is the only place each of them exists.
Fixtures 09 and 10 exist precisely because the accepted fixture 05 carries a
single one-sentence BT-22 and says nothing about the two-note form.

Document notes and correction reasons are capped at 300 characters on input too,
so the product refuses at the keyboard what e-Factura would refuse at the gate.
That input cap is a **product** limit, not a copy of BR-RO-L300: it counts
UTF-16 code units on the raw text, while `cius-limits.ts` counts characters
after `normalize-space`. It is therefore the stricter of the two for every text
— an emoji costs two there and one here — and never the looser, which is the
only direction that matters. `CorrectionInput.reason` carries the cap in the
corrections domain rather than in the HTTP schema, because the storno reason is
a fiscal element of the document, and the rule holds for every caller, not only
for the one that arrives over HTTP.

## What is still unverified

- The official `ro16931-ubl-1.0.9` package is **not** reachable over HTTP from
  here (`mfinante.gov.ro` resets the connection, repeatedly, across sessions),
  but the extracted copy in the project's Drive materials is readable locally at
  `~/gdrive/PROIECTE DEVELOPMENT/RO_E_FACTURA/ro16931-ubl-1.0.9`. The national
  rules in `cius-limits.ts` were read from its flattened
  `preprocessed/ROeFactura-UBL-validation-Invoice_v1.0.8.sch`; the EN 16931
  rules still come from the abstract model files and the validator's own
  responses. Nothing here executes the Schematron: there is no XSLT engine in
  this environment, so a rule no fixture exercises is still a rule nobody has
  run.
- **Fixtures 09 and 10 have not been uploaded.** They are the only documents
  with two BT-22 occurrences — legal reference plus storno reason (09, `FCN`),
  legal reference plus seller remarks (10, `FACT1`) — and the accepted fixture
  05 carries exactly one. Extrapolating its acceptance to them would be a guess
  about a fiscal document, so the repeated note stays unverified until ANAF
  answers. Fixtures 01–08 regenerate byte for byte identical after T-1383 and
  after the move to two notes, so what ANAF did accept has not drifted.
- The validator checks schema and Schematron. It does not check that the
  document states the truth: correct totals with the wrong VAT category pass.
- Nothing here has been sent to the SPV. Acceptance by the validator is not
  acceptance by the system that receives real invoices (T-1346).

## Validating the fixtures

```
node scripts/efactura-fixtures.mjs          # writes .local/efactura-fixtures/*.xml
```

Upload each file at <https://www.anaf.ro/uploadxmi/>, standard `FACT1` — except
the credit notes (06, 09), which go as `FCN`.

Only synthetic documents go there: the validator is a third-party service and an
uploaded file is out of our hands. Every identifier in the fixtures is invented
and belongs to nobody.
