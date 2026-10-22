# VAT treatment snapshots (T-1367)

Scope: domestic RON invoicing by SRL/PFA, B2B/B2C. Invoice owns the fiscal facts;
a future XML exporter consumes public snapshots, not private tables or live profiles.

| Selection | UNCL5305 category | Rate | Exemption reason |
| --- | --- | --- | --- |
| VAT-registered, standard or reduced legal rate | S | Positive | `null` |
| Non-VAT issuer, supported Article 310 regime | O | 0.00 | `Regim special de scutire conform art. 310 din Codul fiscal` |

Article 310 is category **O**, not `E` (T-1383). ANAF's technical recommendation
assigns `O` + `VATEX-EU-O` to supplies by taxable persons not registered for VAT,
and `E` + `VATEX-EU-309` to a different case entirely — the travel agents' margin
scheme, which this product does not issue. `E` is therefore absent from
`VatCategoryCode`: a category nothing can produce would only leave branches no
document reaches. `cubes/invoicing/efactura` still knows all three, because it renders the
standard rather than this product's subset.

The stored rate stays `0.00` while the UBL percentage is **absent**. These are
not in conflict: internally a rate is required and the tax due really is nothing,
while `O` forbids BT-119/BT-152 outright. The mapper — not the model — produces
that absence, because it is a rule of the standard rather than a fact about the
sale. A consumer reading the rate alone would misread it as "VAT 0%", which is
why the PDF and the UI say "Scutit TVA (art. 310)" from the *category*, and why
`vatTreatmentLabel` never formats a percentage for `O`.

The legal text moves with it. For `E` it belonged in BT-120; for `O` that element
is absent and the reference belongs in BT-22, where ANAF's technical
recommendation puts it. BT-22 repeats, so the reference is its own note and the
seller's remarks — or the mandatory storno reason — are a second one, in that
order. Each occurrence has its own 300-character budget (BR-RO-L300) and there
may be twenty of them (BR-RO-A020), which is why document notes and correction
reasons are capped at 300 characters on input: what the product lets you write
has to be something e-Factura can carry. BT-121 carries `VATEX-EU-O`. BR-O-10
itself asks only that a reason be present — the code or the text — so the code
is what this product requires, following ANAF's recommendation, not what the
rule compels. BR-O-02 then removes the buyer's VAT identifier even when the
buyer is VAT registered; the buyer keeps its identity through BT-47.

`vatCategoryCode` and `vatExemptionReason` are required properties in configuration,
line and VAT-breakdown responses. A null reason means legally absent for S, not a
legacy fallback. `RO_STANDARD`, `RO_REDUCED`, `RO_REDUCED_5`, `RO_NON_VAT` are internal
catalogue codes, not UNCL5305 categories or VATEX codes. A zero document total does
not change an S line into O. Reduced positive rates also use S, never Z.

The API non-VAT input requires `vatChange.nonVatBasis = "article_310"`; the UI generates
this field automatically from the existing issuer VAT-registration setting. There is
no additional checkbox or manual legal-basis selection (T-1370). VAT-registered input
forbids that property, including an explicit null. The fiscal basis is stored
as the complete configuration tuple (code/category/rate/reason). `currentVat` projects
its basis from that validated tuple, not from the registration boolean or zero rate
alone. Automatic UI generation is the product rule for the supported Article 310
workflow, not an external verification of a company's fiscal status. Other
non-registration grounds and E/Z/AE/other categories are unsupported. Client entry
and prefix handling are unchanged; external CUI verification is deferred to T-1371.

Issuer configuration is dated. Authoring displays the registration at issueDate;
issued invoices/proformas/corrections use frozen facts. Invoice issuance validates
line calculations, VAT groups and document totals before numbering. O has exactly
one breakdown — the zero beside it is a placeholder, not a rate to group by. S is
grouped by category/rate, using the existing cent-rounding rule.
Proforma-to-invoice checks compatibility at the conversion date. Proforma-to-draft
preserves a valid offered snapshot even if it must be edited before later issuance.
Full correction preserves the original treatment and negates amounts, normalizing
zero to `0.00`; it does not reinterpret the source using the current issuer profile.

PDF templates invoice-v10/proforma-v9 display the legal reason from the snapshot.
No exemption is inferred during rendering.

## Preferred VAT rate on a product (T-1399)

A saved product may carry `preferredVatRateCode`: the code of a taxable rate, never a
percentage, so the percentage is resolved on the document date and a legal rate change
needs no product edit. Absent means the issuer's default.

- **Saving the product.** The code must name a taxable rate in force on the organization's
  calendar date (Europe/Bucharest) — `RO_STANDARD` or `RO_REDUCED` today. `RO_NON_VAT` is
  refused: Article 310 is a status of the issuer, not of a product. The check runs on every
  save, so a preference the law has since retired (`RO_REDUCED_5` after 2025-07-31) keeps the
  product listable and usable on lines, but any edit must replace or remove it explicitly.
  The editor shows it as "<code> (expirată)" and blocks saving until then; there is never a
  silent conversion. A PUT replaces the whole product, so omitting the code removes it.
- **Choosing the product on a line** (`presetVatCode`, invoice and proforma forms). The line
  gets the preferred code when the issuer is VAT registered on the document date and the code
  is among the rates it can charge on that date; otherwise it gets the issuer's default on
  that date (standard rate, `RO_NON_VAT` under Article 310, or nothing when the status cannot
  be determined). **Article 310 always wins over the preference.** The code is resolved at the
  moment of the choice: a later change of the document date does not rewrite filled lines,
  and choosing the product again resolves it on the new date.
- **The server knows nothing of the preference.** It validates each line's own code against
  the issuer on the document date, through the same chains as any line, and refuses an
  incompatible code — `RO_REDUCED` from an Article 310 issuer, on draft save or on issuance —
  rather than correcting it. A preference therefore cannot produce an invoice with the wrong
  VAT treatment; at worst it proposes a code the line must change.

## Guard on the issuer's VAT regime (T-1977)

`PUT /api/issuer` treats two changes as fiscal: a **new regime** (the `vatChange` does not
match the regime already in force on its `effectiveFrom`, so every day from it on is
rewritten) and a **new CIF** of an issuer already configured. Anything else — name,
address, IBAN, branding, a `vatChange` that repeats the current regime — is not fiscal:
it never asks ANAF and saves even while ANAF is down.

**What is checked.** With the `company-lookup` plugin on, the kernel asks ANAF's public
registry (`PlatitorTvaRest/v9/tva`, the client the company lookup uses, sharing its
one-request-a-second queue but not its cache) and reads `scpTVA` only; `perioade_TVA`
and its dates are not used, their semantics being unverified.

- A new regime is checked on `effectiveFrom` and on today (Europe/Bucharest), one request
  when the two are the same day. Both answers must match the regime chosen: registered for
  a VAT payer, not registered for Article 310.
- A new CIF alone is checked today against the regime in force today (or, when none is in
  force yet, the first one scheduled).

**Refusals.**

| Answer | When |
| --- | --- |
| `400 ValidationFailure`, issue in Romanian | ANAF contradicts the regime chosen on either day, or does not know the CIF (`notFound`) |
| `409 DomainConflict` `vat_change_affects_issued_documents` | an invoice or storno of the organization is dated on or after `effectiveFrom` |
| `409 DomainConflict` `fiscal_identifier_change_has_issued_documents` | the CIF changes and the organization has issued any invoice or storno, whatever its date |
| `409 DomainConflict` `issuer_changed_concurrently` | the CIF or the VAT history changed between the read and the save |
| `503 vat_registry_unavailable` | ANAF failed, timed out or its queue is full: try again later |

The registry is asked outside any transaction. The final transaction reads the CIF and
the VAT history again and compares them with what the decision was taken on, then runs
the issued-documents `EXISTS` (`issued_invoices`, `correction_documents`) under the
business lock every issuance takes too. An invoice issued concurrently is therefore
either seen by that check, or issued after the new regime is saved and validated
against it; the two cannot both succeed. Proformas are not fiscal documents and do not
block a change; converting one revalidates the regime on the conversion date.

**Plugin off.** Without `company-lookup` there is no registry: a fiscal change is saved
unchecked and the answer says so in `warnings: ["vat_registry_not_checked"]`, which the
settings screen shows. `warnings` is always present on the `PUT` answer, empty when
there is nothing to report; `GET /api/issuer` does not carry it. A failure with the
plugin on — a missing key, an error, a timeout — is never "plugin off": it is a 503.

**Audit.** `issuer.configured` records the check in `reason`: `vat_registry:checked`,
`vat_registry:not_checked` (plugin off) or `vat_registry:not_needed` (no fiscal change).

**Future dates.** For a future `data` ANAF answers with the current status, so a
registration that starts later cannot be confirmed in advance: save it once it appears
in the registry. The same holds for a future Article 310 regime of a company still
registered today.

## Inspected evidence

Existing extracted official package: **ro16931-ubl-1.0.9**, a local copy kept
outside this repository.
The SCH root only includes dependencies; the rules below were read from the
extracted dependency previews on 2026-09-16, not inferred from the root alone.

- [Cod fiscal](https://legislatie.just.ro/Public/DetaliiDocument/171282), art. 310:
  small-business special exemption; art. 319: indication of the applicable exemption.
- [MF technical entry](https://mfinante.gov.ro/ro/web/efactura/informatii-tehnice).
- `abstract/EN16931-model.sch`:
  BR-CO-04/BR-47 require line/breakdown categories; BR-S-05 positive rate;
  BR-S-10 forbids reason for S; BR-E-01 exactly one E breakdown; BR-E-05 rate zero;
  BR-E-10 requires reason text **or** code. E rate is zero, not absent (unlike O).
- `cius-ro/RO16931-rules.sch`:
  BR-RO-L100 limits BT-120 to 100 characters after `normalize-space`;
  BR-RO-065 accepts the seller tax registration ID as an alternative to VAT ID.
  The flattened `preprocessed/ROeFactura-UBL-validation-Invoice_v1.0.8.sch` was
  read in full on 2026-09-17 and is where `cubes/invoicing/efactura/cius-limits.ts` comes
  from. It also settles a citation this file used to carry: there is **no**
  BR-RO-060 in CIUS-RO 1.0.1 — BT-22 as the place for the Article 310 reference
  rests on ANAF's technical recommendation alone.
- `UBL/EN16931-UBL-model.sch` and
  `codelist/EN16931-UBL-codes.sch`.
  BR-CL-22 requires VATEX when a reason code is supplied. The VATEX mapping for
  Article 310 was asserted later, by ANAF's own technical recommendation
  (`VATEX-EU-O`, with category `O`); see docs/EFACTURA.md. Until then BT-120 text
  was used rather than guessing a code.

These are inspected rules, not an executed full XSLT/UBL validation or a general
compliance certificate. XML generation, complete schema/business-rule validation
and ANAF transport remain separate work.

## Storage

The issuer and invoicing baselines constrain the S/O tuples and reason fields with CHECKs on
issuer configurations and on draft/issued/proforma/correction lines and tax
breakdowns. There is no legacy decoder, backfill or automatic data deletion; a
database from an older schema is recreated (README, "Schema during development").
A real/local data reset is a separate operational action; running the tests does
not reset the existing app.

## Remaining work

- **T-1345 — XML export:** deterministic UBL generation from public snapshots,
  official XSD/Schematron CIUS-RO validation and fixtures for supported S/O,
  SRL/PFA and B2B/B2C cases. The inspected SCH materials are the package above.
- **T-1346 — ANAF transport:** authentication, submission, status/response handling,
  safe retries, idempotency and audit. Separate from producing the XML file.
- **T-1371 — company lookup API:** verify/autocomplete company details from CUI.
  The requested provider is recalled as offering 100 free requests per month;
  its identity and current terms still need verification.
- **T-1374 — local activation:** integrate and run the new version locally.
  The existing local app/database was not updated by this implementation.
  The schema is a development baseline; any database recreation requires a separately
  confirmed operational action, never an implicit reset during deployment.
