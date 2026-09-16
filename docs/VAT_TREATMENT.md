# VAT treatment snapshots (T-1367)

Scope: domestic RON invoicing by SRL/PFA, B2B/B2C. Invoice owns the fiscal facts;
a future XML exporter consumes public snapshots, not private tables or live profiles.

| Selection | UNCL5305 category | Rate | Exemption reason |
| --- | --- | --- | --- |
| VAT-registered, standard or reduced legal rate | S | Positive | `null` |
| Non-VAT issuer, supported Article 310 regime | E | 0.00 | `Regim special de scutire conform art. 310 din Codul fiscal` |

`vatCategoryCode` and `vatExemptionReason` are required properties in configuration,
line and VAT-breakdown responses. A null reason means legally absent for S, not a
legacy fallback. `RO_STANDARD`, `RO_REDUCED`, `RO_REDUCED_5`, `RO_NON_VAT` are internal
catalogue codes, not UNCL5305 categories or VATEX codes. A zero document total does
not change an S line into E. Reduced positive rates also use S, never Z.

The API non-VAT input requires `vatChange.nonVatBasis = "article_310"`; the UI generates
this field automatically from the existing issuer VAT-registration setting. There is
no additional checkbox or manual legal-basis selection (T-1370). VAT-registered input
forbids that property, including an explicit null. The fiscal basis is stored
as the complete configuration tuple (code/category/rate/reason). `currentVat` projects
its basis from that validated tuple, not from the registration boolean or zero rate
alone. Automatic UI generation is the product rule for the supported Article 310
workflow, not an external verification of a company's fiscal status. Other
non-registration grounds and O/Z/AE/other exemptions are unsupported. Client entry
and prefix handling are unchanged; external CUI verification is deferred to T-1371.

Issuer configuration is dated. Authoring displays the registration at issueDate;
issued invoices/proformas/corrections use frozen facts. Invoice issuance validates
line calculations, VAT groups and document totals before numbering. E has exactly
one breakdown. S is grouped by category/rate, using the existing cent-rounding rule.
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
- `UBL/EN16931-UBL-model.sch` (`1WI_4BXpu_mabZdph-m6eBqDHkLs4h-Ed`) and
  `codelist/EN16931-UBL-codes.sch` (`1qeo90pxiZkwzb9iKkIOQzzUJAfO8J-Hw`).
  BR-CL-22 requires VATEX when a reason code is supplied. No specific VATEX mapping
  for Article 310 has been asserted; BT-120 text is used instead of guessing a code.

These are inspected rules, not an executed full XSLT/UBL validation or a general
compliance certificate. XML generation, complete schema/business-rule validation
and ANAF transport remain separate work.

## Development migration

020 replaces placeholder `standard` persistence with constrained S/E tuples and
reason fields across issuer configurations and draft/issued/proforma/correction
lines and tax breakdowns. It is fresh-only, with no legacy decoder, backfill or
automatic data deletion. The populated-data guard runs before 020's DDL. The
migration runner is atomic **per migration**, not across all pending migrations.

Use existing `migrate --json`, `migrate --apply --json`, repeat and `doctor --json`
against a fresh temporary development directory. A real/local data reset is a
separate operational action; running these tests does not reset the existing app.

## Remaining work

- **T-1345 — XML export:** deterministic UBL generation from public snapshots,
  official XSD/Schematron CIUS-RO validation and fixtures for supported S/E,
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
