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
document reaches. `cube/efactura` still knows all three, because it renders the
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
has to be something e-Factura can carry. BT-121 carries `VATEX-EU-O`, the only
code BR-O-10 accepts. BR-O-02 then removes the buyer's VAT identifier even when
the buyer is VAT registered; the buyer keeps its identity through BT-47.

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

PDF templates invoice-v9/proforma-v8 display the legal reason from the snapshot.
No exemption is inferred during rendering.

## Inspected evidence

Existing extracted official package: **ro16931-ubl-1.0.9**, under
`PROIECTE DEVELOPMENT/RO_E_FACTURA` in the project's Google Drive materials.
The SCH root only includes dependencies; the rules below were read from the
extracted dependency previews on 2026-09-16, not inferred from the root alone.

- [Cod fiscal](https://legislatie.just.ro/Public/DetaliiDocument/171282), art. 310:
  small-business special exemption; art. 319: indication of the applicable exemption.
- [MF technical entry](https://mfinante.gov.ro/ro/web/efactura/informatii-tehnice).
- `abstract/EN16931-model.sch` (Drive file `14KJeUxbduaLZDelOon_zCcFnveFvw5Dk`):
  BR-CO-04/BR-47 require line/breakdown categories; BR-S-05 positive rate;
  BR-S-10 forbids reason for S; BR-E-01 exactly one E breakdown; BR-E-05 rate zero;
  BR-E-10 requires reason text **or** code. E rate is zero, not absent (unlike O).
- `cius-ro/RO16931-rules.sch` (`1NxhRyPCphVyMeh9gq_EBpdUAWYc3ewZf`):
  BR-RO-L100 limits BT-120 to 100 characters after `normalize-space`;
  BR-RO-065 accepts the seller tax registration ID as an alternative to VAT ID.
  The flattened `preprocessed/ROeFactura-UBL-validation-Invoice_v1.0.8.sch` was
  read in full on 2026-09-17 and is where `cube/efactura/cius-limits.ts` comes
  from. It also settles a citation this file used to carry: there is **no**
  BR-RO-060 in CIUS-RO 1.0.1 — BT-22 as the place for the Article 310 reference
  rests on ANAF's technical recommendation alone.
- `UBL/EN16931-UBL-model.sch` (`1WI_4BXpu_mabZdph-m6eBqDHkLs4h-Ed`) and
  `codelist/EN16931-UBL-codes.sch` (`1qeo90pxiZkwzb9iKkIOQzzUJAfO8J-Hw`).
  BR-CL-22 requires VATEX when a reason code is supplied. The VATEX mapping for
  Article 310 was asserted later, by ANAF's own technical recommendation
  (`VATEX-EU-O`, with category `O`); see docs/EFACTURA.md. Until then BT-120 text
  was used rather than guessing a code.

These are inspected rules, not an executed full XSLT/UBL validation or a general
compliance certificate. XML generation, complete schema/business-rule validation
and ANAF transport remain separate work.

## Development migration

020 replaces placeholder `standard` persistence with constrained S/O tuples and
reason fields across issuer configurations and draft/issued/proforma/correction
lines and tax breakdowns. It is fresh-only, with no legacy decoder, backfill or
automatic data deletion. The populated-data guard runs before 020's DDL. The
migration runner is atomic **per migration**, not across all pending migrations.

Use existing `migrate --json`, `migrate --apply --json`, repeat and `doctor --json`
against a fresh temporary development directory. A real/local data reset is a
separate operational action; running these tests does not reset the existing app.

## Remaining work

- **T-1345 — XML export:** deterministic UBL generation from public snapshots,
  official XSD/Schematron CIUS-RO validation and fixtures for supported S/O,
  SRL/PFA and B2B/B2C cases. The inspected SCH materials already exist in Drive.
- **T-1346 — ANAF transport:** authentication, submission, status/response handling,
  safe retries, idempotency and audit. Separate from producing the XML file.
- **T-1371 — company lookup API:** verify/autocomplete company details from CUI.
  The requested provider is recalled as offering 100 free requests per month;
  its identity and current terms still need verification.
- **T-1374 — local activation:** integrate and run the new version locally.
  The existing local app/database was not updated by this implementation.
  Migration 020 is fresh-only; any database recreation requires a separately
  confirmed operational action, never an implicit reset during deployment.
