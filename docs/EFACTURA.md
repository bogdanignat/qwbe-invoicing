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
- Anything stated but empty is refused rather than dropped. The renderer omits
  an empty element, so a blank identifier or exemption code would satisfy a rule
  here and then be missing from the XML ANAF reads.
- BT-120 is measured the way XPath measures it: only space, tab, CR and LF
  collapse **or trim** (a no-break space is a character, at the ends as much as
  in the middle, which is why `String.trim` is not used), and the 100-character
  limit counts characters, not UTF-16 code units.
- Parties: ISO 3166-1 alpha-2 country, ISO 3166-2 subentity for RO, and the
  seller identifiable by BT-31 **or** BT-32.

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
| Is Article 310 `E` or `O`? | **Both are accepted.** See below. |

## VAT category for Article 310 issuers: the repository and ANAF disagree

`docs/VAT_TREATMENT.md` and migration 020 chose category **E** with the Article
310 text in BT-120, recording that "no specific VATEX mapping for Article 310
has been asserted".

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

| | Repository today (E) | ANAF recommendation (O) |
| --- | --- | --- |
| BT-118 / BT-151 | `E` | `O` |
| BT-119 / BT-152 | `0.00`, present | **absent** |
| BT-121 | absent | `VATEX-EU-O` |
| Legal reference | BT-120 text | BT-22 (BR-RO-060) |

**The validator does not settle this.** Both fixture 04 (`E`) and fixture 05
(`O`) were accepted without a single assertion, so the choice is a fiscal
interpretation and not a schema constraint. What is left is the asymmetry in
the evidence: ANAF's own technical recommendation names `O` for this exact case
and `E` for a different one, and nothing in the repository's history cites a
source for `E`.

Switching is a mapping change, not a rewrite — the generator already renders all
three categories. What it would touch outside the generator: `VatCategoryCode`
in `cube/invoicing/domain/invoice.ts`, the `tax_category` CHECK constraint in
migration 020, the VAT catalogue, and `docs/VAT_TREATMENT.md`. It would also
propagate BR-O-02: an Article 310 invoice could no longer carry the buyer's VAT
identifier, even for a VAT-registered buyer, who would be named by BT-47.

Pending that decision the repository stays on `E`, which is valid.

## What is still unverified

- The official `ro16931-ubl` Schematron package could not be downloaded from
  `mfinante.gov.ro` (connection reset, repeatedly, across sessions). The local
  rules were therefore written from EN 16931, ANAF's technical recommendation
  and the validator's own responses — not from the rule file itself. A rule
  that no fixture exercises is a rule nobody has checked.
- The validator checks schema and Schematron. It does not check that the
  document states the truth: correct totals with the wrong VAT category pass.
- Nothing here has been sent to the SPV. Acceptance by the validator is not
  acceptance by the system that receives real invoices (T-1346).

## Validating the fixtures

```
node scripts/efactura-fixtures.mjs          # writes .local/efactura-fixtures/*.xml
```

Upload each file at <https://www.anaf.ro/uploadxmi/>, standard `FACT1`.

Only synthetic documents go there: the validator is a third-party service and an
uploaded file is out of our hands. Every identifier in the fixtures is invented
and belongs to nobody.
