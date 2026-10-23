# e-Factura XML generation (T-1345)

Scope of this step: a pure generator that turns a frozen fiscal snapshot into
UBL 2.1 / CIUS-RO XML, plus the host mapping from the invoicing model and
synthetic fixtures for the official validator.

**Nothing is transmitted.** The only thing exposed is a download: `GET
/api/invoices/{id}/efactura.xml` and `GET /api/corrections/{id}/efactura.xml`.
Both routes read a frozen snapshot and render it on the spot — no migration, no
write to `eFacturaStatus`, nothing stored and nothing sent. They stay for tests
and debugging; the interface no longer calls them (its button now submits, and
the exact XML of a submission is downloaded from its history). Transport to the SPV is
T-1346: see [Submitting to ANAF](#submitting-to-anaf-t-1346).

Both routes belong to the `efactura` plugin. With it off (`QWBE_PLUGINS` without
`efactura`) they answer 404, are absent from OpenAPI, and every invoice response
says `eFacturaStatus: null`; issuance, PDF and the fiscal validations do not change.

A refusal is reachable today: the invoicing domain does not cap line
descriptions or party names at input, while CIUS-RO does at export (T-1390), so
an invoice can be issued — and, being immutable, stays issued — that the export
answers with `400` and the list of limits it breaks.

## Layout

| Unit | Role |
| --- | --- |
| `cubes/invoicing/efactura/contracts/document.ts` | `EFacturaDocument` — the normalized fiscal contract, every amount a decimal string, every value already positive |
| `cubes/invoicing/efactura/validation.ts` + `totals.ts`, `vat-rules.ts`, `vat-groups.ts` | the EN 16931 rules checkable without the official validator |
| `cubes/invoicing/efactura/cius-limits.ts` | the CIUS-RO limits and address rules, read from the official Schematron |
| `cubes/invoicing/efactura/codelists.ts` | the EN 16931 code lists we can violate: countries and VATEX |
| `cubes/invoicing/efactura/xml.ts` | deterministic serializer: element order is array order, no mixed content, no unrepresentable characters |
| `cubes/invoicing/efactura/ubl.ts`, `ubl-party.ts` | the UBL document and party builders, in `xsd:sequence` order |
| `cubes/invoicing/efactura/profile.ts` | the CIUS-RO constants, injected rather than hard-coded |
| `kernel/efactura/efactura-mapper.ts` | the host translation from `IssuedInvoice` / `CorrectionDocument` |
| `kernel/api/handlers-efactura.ts` (routes), `kernel/api/api-responses.ts` — `efacturaXml` | renders the download, mounted only with the e-Factura plugin enabled; a mapping refusal travels as the list of reasons, not as a 500 |
| `cubes/invoicing/efactura/fixtures.test-support.ts` | the synthetic documents, all invented |

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
- BR-CO-26: the seller is identified by BT-29, BT-30 or BT-31 — and **not** by
  BT-32, which we render under its own tax scheme precisely because it is not a
  VAT registration. BR-RO-065 accepts BT-32 and BR-CO-26 does not, so a seller
  carrying only that one satisfies the national rule and fails the European
  one. Issuance already requires the trade registry number (BT-30), so the
  product cannot reach this; the contract can.
- Code lists, in `codelists.ts`: the country code (BR-CL-14, the EN 16931 list
  — `1A` and `XI` are in it, `UK` is not), the VAT exemption reason code
  (BR-CL-22) and the country prefix of a VAT identifier (BR-CO-09, the same list
  plus `EL`, because Greece registers under a prefix that is not its country
  code). A code list is not a shape: `XX` is two capital letters and no country,
  and an invented VATEX code names a legal ground that does not exist. Each
  comparison follows its own rule: BR-CL-22 is the one that tests
  `upper-case()`, so `vatex-eu-o` is the same code, while BR-CL-14, BR-CO-09 and
  the national lists are case-sensitive — `ro19999919` is not a Romanian VAT
  number to ANAF. BR-CL-23 is checked by half: the rule refuses any unit code
  that still holds a space after `normalize-space`, and that half is here,
  because it is one comparison and it catches two codes written into one field.
  Emptiness is read with `String.trim` instead, and deliberately: XPath knows
  only the four XML space characters, so a field holding nothing but U+00A0
  is an empty field to a reader and a code no list contains to ANAF.
  Membership in UN/ECE Recommendation 20 is not: 2162 codes do not fit the
  cube's size budget. The invoicing host picks the unit from a closed catalogue
  of eight, each verified against the official list, but that is a guarantee of
  the host — a caller that builds an `EFacturaDocument` itself can still name a
  unit that does not exist.
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
  Both rules read BT-40/BT-55 through `normalize-space`, so `" RO "` is Romania
  here too — comparing it raw let a padded country code skip both checks. The
  other direction holds as well: no rule asks a **foreign** address for a
  subdivision (BR-RO-211 does, but of the delivery address, which we never
  emit), so a blank BT-39/BT-54 outside Romania is accepted and the element is
  omitted rather than sent empty.
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
in the invoicing model, the eight CHECK constraints across the issuer and invoicing baselines accept the
Article 310 tuple only under `O`, and `E` is refused everywhere — by the domain
validator, by the database and by the web decoder — even when the rest of the
tuple is exactly right. The stored rate stays `0.00`, because the model requires
a rate and the tax due really is nothing; the **mapper** produces the absence of
BT-119/BT-152, which is a statement about the category rather than about the
sale. The two absences do not rest on the same ground: BR-O-05 forbids BT-152 on
a line outright, while nothing forbids BT-119 on the breakdown — BR-48 merely
stops requiring it there and stays satisfied even if a rate is present. Omitting
it is ANAF's recommended shape and this product's rule, and the refusal says so
instead of citing BR-48 for a violation BR-48 does not define. BT-121 is the
mirror image: BR-O-10 is satisfied by either the exemption reason code **or**
the reason in prose, so demanding exactly `VATEX-EU-O` asks for more than the
rule does. That demand is this product's too — one ground, named by the code
ANAF's recommendation names, not left to be read out of a sentence — and its
refusal is labelled the same way.

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
single one-sentence BT-22 and says nothing about the two-note form. The form
itself was accepted by the SPV on ANAF TEST on 2026-10-20, for an invoice and a
storno of an Article 310 issuer (see "What is still unverified").

Document notes and correction reasons are capped at 300 characters on input too,
so the product refuses at the keyboard what e-Factura would refuse at the gate.
That input cap is a **product** limit, not a copy of BR-RO-L300: it counts
UTF-16 code units, while `cius-limits.ts` counts characters after
`normalize-space`. For a note, which is stored as it was typed, that makes it
the stricter of the two — an emoji costs two there and one here — and never the
looser, which is the only direction that matters. A correction reason is counted
after `trim()`, and `trim()` removes more than `normalize-space` collapses: a
reason padded with a no-break space is 300 to the input cap and 301 to
BR-RO-L300. It never arrives that way, because the same layer stores the reason
trimmed, so the text the mapper reads is the text that was counted — the
guarantee holds for the stored value, not for every raw string a caller could
hand in. `CorrectionInput.reason` carries the cap in the
corrections domain rather than in the HTTP schema, because the storno reason is
a fiscal element of the document, and the rule holds for every caller, not only
for the one that arrives over HTTP.

## Connecting to ANAF (OAuth, T-1346)

The SPV is reached with an OAuth token issued to one organization's certificate.
The connection lives in `cubes/invoicing/efactura/connection` (states, attempt,
callback, refresh) and `kernel/efactura/anaf/` (ANAF client, token cipher, callback
HTTP); its rows in `efactura_connections` and `efactura_oauth_attempts`.

| Route | Grant | What it does |
| --- | --- | --- |
| `POST /api/efactura/connection/start` | `efactura:connection.manage`, session + CSRF | a new attempt; answers ANAF's `authorize` URL and sets the attempt cookie; `409 efactura_not_configured` without the ANAF variables, `409 efactura_issuer_cif_invalid` when the issuer has no CIF the SPV can check |
| `GET /api/anaf/callback` | none: the attempt cookie | ANAF's redirect; always `303` to `/integrations?anaf=<code>` |
| `GET /api/efactura/connection` | `efactura:read` | `not_configured`, `disconnected`, `connected` or `needs_reconnect`, the environment, the verified CIF, the refresh token's expiry, who connected and when, and whether your own attempt never came back. Never a token |
| `DELETE /api/efactura/connection` | `efactura:connection.manage`, session + CSRF | a new generation, the tokens deleted; ANAF's `revoke` is asked after the commit, best effort |

All four belong to the `efactura` plugin: off, they answer 404 and are absent from OpenAPI.

**The attempt.** `start` draws a 32-byte nonce, stores only its SHA-256 with the
connection's generation, and replaces the organization's previous attempt, which
can then never complete. The nonce travels only in `qwbe_anaf_oauth` (HttpOnly,
Secure, SameSite=Lax, `Path=/api/anaf`, Max-Age 600). The attempt lives ten minutes
and is consumed by the first callback that presents it, whatever ANAF answered. The
`authorize` URL carries `response_type=code`, `client_id`, `redirect_uri` (the
configured one, never one from a request) and `token_content_type=jwt`; no `state`
and no `scope`, because ANAF closes the session when `state` is sent (verified live,
2026-10-19; ANAF's OAuth guide, p. 23: "State se lasă necompletat").

**The callback**, fail-closed at every step: no cookie, an attempt that is expired,
consumed or no longer the current one, `error=`, or a missing code end it with a
fixed code. Otherwise the attempt is consumed in a short transaction; the code is
exchanged (Basic client auth, `token_content_type=jwt`) outside any transaction; the
token's right on the issuer's CIF is checked with a read-only
`listaMesajePaginatieFactura` (one day, page 1). Only a recognised positive answer (a
list, or "no messages") saves the connection: "no right" is `fara_drept_cif`; a
timeout, a redirect, an unknown body, a throttle or anything else is
`verificare_esuata` and nothing is saved. The save checks, in the same transaction,
that the consumed attempt is still the organization's current one and that the
generation it started from still holds, so a late callback of a replaced attempt or
one overtaken by a disconnect writes nothing (`conexiune_schimbata`). Once ANAF has
granted a pair, the one not kept is revoked after the commit, best effort, without
changing the outcome: the new pair on `fara_drept_cif`, `verificare_esuata` and
`conexiune_schimbata`, the previous pair when a reconnect replaces it. The issuer's
CIF is checked at start as well; the callback keeps its check for a CIF changed in
between. The answer is
`no-store` and `Referrer-Policy: no-referrer` and clears the cookie. The query string,
the cookie, the code and the tokens never reach a log, the failure log included: a
storage failure logs its tag and fixed operation name, and the browser sees `eroare`.

The codes: `conectat`, `neconfigurat`, `tentativa_lipsa`, `tentativa_expirata`,
`tentativa_folosita`, `refuzat_anaf`, `cod_lipsa`, `schimb_esuat`, `fara_drept_cif`,
`verificare_esuata`, `conexiune_schimbata`, `eroare`.

**The tokens** are sealed with AES-256-GCM under `ANAF_TOKEN_KEY_FILE`
(`kernel/crypto/sealed-text.ts`), each bound to
`efactura:<access|refresh>:<organization>:<environment>:<client_id>:<generation>`. A
pair that does not open (another key, client, environment or generation) reads as
`needs_reconnect`. A connect and a disconnect each start a new generation; a refresh
writes a new revision of the pair. The refresh (`refreshConnection`, called only by the
dispatcher, never from a request) asks ANAF outside any transaction and stores the
answer only if the generation and revision it observed still hold; `invalid_grant`
marks `needs_reconnect` under the same condition, so an old failure cannot invalidate a
newer pair, and a refresh overtaken by another one or by a disconnect is dropped. The
access token lives as long as ANAF's `expires_in` says: 90 days on ANAF TEST (seen live,
2026-10-20). ANAF does not say when a refresh token lapses: it is taken as 365 days from
the connection and not extended by a refresh; that is still unconfirmed and followed
separately.

Connections, disconnections and `needs_reconnect` are audited
(`efactura_connection.connected | .disconnected | .needs_reconnect`) in the transaction
that makes the change.

**Backups** exclude the rows of both tables (`excludedTableData`, like
`browser_sessions`): no backup carries an ANAF token or an attempt. After a restore,
e-Factura reads `disconnected` and the organization **connects again with its
certificate**.

### Residual risk: login CSRF without `state`

Without `state`, ANAF's authorization code is not bound cryptographically to the
attempt that asked for it. The attempt cookie proves only that this browser started an
attempt in the last ten minutes; the CIF check proves only that the token has a right
on the issuer's CIF. What remains possible: **someone else who holds an SPV right on
the same CIF** could bind their own token in place of yours, if they get their
callback URL (with their code) opened in your browser within your ten-minute window.
The effect: submissions would leave under their token, for your company. It does not
expose another company's data, and that person can already submit in the SPV for this
CIF directly.

Mitigations: the short window, the single-use attempt that a newer one replaces, the
audit trail with the moment and the person who connected, and disconnect/reconnect at
any time from Settings. PKCE (`code_challenge`) is not assumed and has not been tried
yet: it needs a new connection with the certificate on ANAF TEST, followed separately.
Until that test the risk stays, accepted by Bogdan on 2026-10-19. If ANAF accepts PKCE
without closing the session it is added; otherwise the acceptance stands.

## Submitting to ANAF (T-1346)

A user submits one issued document at a time; nothing is ever submitted on its
own. The states and the reading of ANAF's answers are pure functions in
`cubes/invoicing/efactura/submissions`; the HTTP calls, the storage and the
dispatcher are the host's (`kernel/efactura/dispatch`, `kernel/storage/postgres-efactura-*.ts`).

| Route | Grant | What it does |
| --- | --- | --- |
| `POST /api/invoices/{id}/efactura/submission`, `POST /api/corrections/{id}/efactura/submission` | `efactura:submit`, session + CSRF | queues the document: `202` with the new submission, or `200` with the one it already has |
| `GET /api/invoices/{id}/efactura/submissions`, `GET /api/corrections/{id}/efactura/submissions` | `efactura:read` | the current submission and every earlier one, newest first, with ANAF's own messages (sanitized), and which `unknown` submission was replaced by which (`resubmissions`) |
| `GET /api/efactura/submissions/{id}/xml` | `efactura:read` | the exact XML that was submitted |
| `GET /api/efactura/submissions/{id}/response` | `efactura:read` | ANAF's ZIP, once it is stored; `404` before |

All of them belong to the `efactura` plugin: off, they answer 404 and are absent from OpenAPI.

**Submit.** The XML is generated from the frozen snapshot (`UBL` for an invoice,
`CN` for a correction), checked to be at most 10 MB, and stored byte for byte
with its SHA-256 and size. It is refused with `409` when e-Factura is not
configured (`efactura_not_configured`), not connected (`efactura_not_connected`),
when the issuer's CIF in the snapshot is not the CIF the connection was verified
for (`efactura_cif_mismatch`), and when the XML is too large
(`efactura_xml_too_large`); a proforma is not an issued document and answers
`404`. A document for a private person is submitted like any other (see B2C below). A document whose current submission is live, `unknown` or `accepted` gets
that submission back (`200`); after `rejected` or `refused` a new one is queued.
The partial unique index on the current submission makes two concurrent submits
queue exactly one. The row, the document's status and the audit row
`efactura_submission.queued` are written in one transaction.

**B2C: documents for a private person.** The law (OUG 120/2021 art. 10^1, as
amended by OUG 138/2024) makes every taxable person established in Romania, VAT
registered or not, send its invoices to private persons through RO e-Factura,
within 5 working days of issue; Legea 88/2026 lifts this only for sellers
identified by a CNP, and the issuer here always has a CUI. A storno to a private
person is an invoice too. Whether the buyer is a private person is read from the
document's frozen snapshot (`customer.partyType = individual`) and stored with the
submission (`buyer_is_individual`, `NOT NULL`, immutable like the XML): the
dispatcher uploads such a submission to
`POST {base}/uploadb2c?standard={UBL|CN}&cif=<issuer CIF>` instead of `upload`, and
so does every later upload of it (a retry after a 401/403, a resubmit). `validare`,
`stareMesaj`, the list, `descarcare` and the reading of their answers are the same
as for B2B, and reconciliation still searches ANAF's list by the issuer's CIF, never
by the buyer's. BT-47 carries the buyer's CNP only when the customer has one
(their choice to be identified, art. 10^1 alin. (3)), otherwise `0000000000000`.
The 5-day deadline is not tracked by the application.

**The CNP is personal data.** It lives only in the frozen snapshot, in the
submitted XML and in ANAF's ZIP (which holds that XML), and those bytes are read
only with `efactura:read` (`/xml`, `/response`). It is never in the call log
(`efactura_submission_attempts` has no URL or body), the audit or the logs; and
because ANAF may echo a CNP back in its messages, every run of exactly 13 digits
in ANAF's texts (errors and the list's `detalii`) is masked as `*************`
before the text is cut to size and stored or shown
(`submissions/domain/replies.ts`). ANAF's indexes and ids are separate fields and
are not touched.

**States.** `queued → validating → uploading → processing → accepted | rejected`,
plus `refused` (ANAF said why, nothing was taken) and `unknown` (nobody can tell
whether ANAF took it). The archive of a decided submission goes
`none → pending → stored`. The document shows its current submission in
`e_factura_status`: `not_sent`, `queued`, `processing` (validating and uploading
read as processing), `accepted`, `rejected`, `refused` or `unknown`, on invoices
and corrections alike; it is written only in the transaction of the transition.
That column is the only one of an issued invoice or a correction that may change
(the triggers refuse an update of any other).

**The dispatcher** is the one executor. It starts in `serve` once the
application is ready and only with the plugin on, on its own PostgreSQL
connection, and leads while it holds a session advisory lock there. Taking the
lock bumps an epoch (`efactura_dispatcher_epoch`); every transaction it runs
first proves, inside itself, that this connection still holds the lock and the
epoch is still its own, so an executor that lost its right cannot write. A second
`serve` waits as a candidate. On taking the lead it recovers: `uploading` becomes
`unknown` (an upload may have reached ANAF), `validating` goes back to `queued`
(validation is idempotent), `processing` resumes polling and `pending` archives
resume downloading. Losing the lock, the connection or the maintenance barrier, or
any of its transactions failing, interrupts the step in flight (its ANAF call is
aborted), closes the connection and starts over as a candidate. On shutdown it is
the first thing stopped, before the drain.

**`validare` goes to ANAF's public validator** in both environments:
`https://webservicesp.anaf.ro/prod/FCTEL/rest/validare/{FACT1|FCN}`, `POST` with
the XML as `text/plain` and **no token**. ANAF TEST does not serve it (checked
2026-10-20: `api.anaf.ro/test/FCTEL/rest/validare/FACT1` answers 401 without a
token and 404 with one), while the public service answers `{"stare":"ok"}` for
fixtures 05 (`FACT1`) and 06 (`FCN`). It only checks the XML and registers
nothing in SPV; the address is a constant in `endpoints.ts`. Every other call
(`upload` or `uploadb2c`, `stareMesaj`, the list, `descarcare`) stays on
`api.anaf.ro/{test|prod}/FCTEL/rest` with the Bearer token, which never leaves
for another host.

One step at a time: `queued` → `validare` (`refused` on ANAF's errors, back to
`queued` on anything unclear) → `uploading`, **committed before the POST** →
upload, outside any transaction → `processing` with ANAF's index, `refused` on
`ExecutionStatus="1"` with errors, `queued` only on an explicit 401/403 (after
one refresh), and **`unknown` on anything else**: a timeout, a broken connection, a
redirect, a 5xx, a 429, a body that does not parse or is too large. If storing the
upload's answer fails, the submission stays `uploading` and the next recovery
makes it `unknown`. Then `stareMesaj` 1, 2, 5, 10 and 30 minutes after the upload
and hourly after that → `accepted` or `rejected` with the download id (or
`refused` for "XML cu erori nepreluat de sistem" without one) → `descarcare` →
the ZIP in `efactura_responses`, archive `stored`.

**ANAF's ZIP** holds two files: `<index>.xml`, byte for byte the submitted XML (same
SHA-256), and `semnatura_<index>.xml`, ANAF's XMLDSig signature over it (`DigestValue`
= the SHA-256 of the submitted XML, `rsa-sha1`). On ANAF TEST the signing certificate
is `CN=ANAF TEST`, self-signed, valid 2021–2031; in production it is ANAF's own.
Documents sent to ANAF TEST never show in the SPV portal: there the API's answer (this
ZIP) is the only proof.

**The connection's CIF** is checked again before every step: a submission whose
CIF is not the one the organization's connection is now verified for makes no ANAF
call at all (no `validare`, no upload, no poll). It stays where it is and waits,
like a submission of an organization with no connection, 15 minutes at a time; a
`queued` one shows the reason in its `errors` until it is sent: `conexiune_alt_cif`, or
`neconectat` while the organization has no usable connection at all.
It is never `refused`: ANAF refused nothing.

**A 401/403 is the only automatic reupload.** An explicit 401/403 at the upload
sends the submission back to `queued`, the token is refreshed once, and it goes
through `validare` and the upload again. `validare` carries no token, so a
401/403 there refreshes nothing: like any other unclear validation answer, the
submission goes back to `queued` and is validated again a minute later. That is safe because
ANAF refused the request at authentication, before processing it: nothing was
taken. Every other unclear upload answer is `unknown`.

**Budgets**, reserved in the database before each call, in the transaction that
takes the step, so a call that times out has still been counted: at most 90
`stareMesaj` and 9 `descarcare` per message per day (Europe/Bucharest days, reset
at its midnight) and 900 calls per minute per organization. A 429 pauses the
organization for its `Retry-After` in whole seconds, at most 30 (30 when the
header is anything else). Every call is logged in `efactura_submission_attempts`
(operation, classified outcome, HTTP status, duration): never a body, never a token.

**Tokens** are refreshed only by the dispatcher: ahead of time when the access
token has less than 7 days left, and once after a 401/403. A pair that such a
refresh produced is not refreshed again on the next refusal, so a token ANAF keeps
refusing never turns into a loop. A request that calls ANAF (the reconciliation
below) never refreshes: on a 401/403 it sets `refresh_requested` on the connection
row, only for the very pair it was refused with, and answers `409
efactura_connection_refreshing`. The dispatcher takes such a request first in its
next turn (clearing the flag as it takes it) and applies the same
one-refresh-per-refusal rule; every write of the connection row clears the flag.

**No automatic replay.** Nothing `unknown` is ever uploaded again by the
application: not by the dispatcher, not by its recovery, not by a submit. Finding
out what happened to it, and resubmitting it, is the reconciliation below: always
the user's, always confirmed.

Audit: `efactura_submission.queued | .accepted | .rejected | .refused | .unknown | .restored_unknown | .linked | .resubmitted`,
each in the transaction of its transition; the dispatcher's actor is `efactura:dispatcher`.

### The interface

Integrări → ANAF e-Factura (with the plugin on, even when it is the only
integration) shows the environment as a label (`TEST` / `PRODUCȚIE`, never editable),
the connection's state, the verified CIF, who connected and when, the refresh token's
expiry with a warning 30 days before it, "Conectează cu certificatul" (a top-level
navigation to the `authorizeUrl` that `start` answers) and "Deconectează" (confirmed).
The callback's `?anaf=<code>` is shown once, in Romanian, and dropped from the address;
an attempt of yours that never came back says to retry in a few minutes.

On an invoice and on a storno the head button that used to export the XML is now
"Trimite în e-Factura": active only with a `connected` connection and while the document
is `not_sent`, `rejected` or `refused` ("Retrimite"); "Se procesează la ANAF" while it
is queued or processing, with the history polled every 12 s until ANAF decides and then
every 60 s only while ANAF's answer ZIP is still being fetched;
"Înregistrată în e-Factura" once accepted, with the upload index, ANAF's ZIP and the
submitted XML. An `unknown` document explains that nobody knows whether ANAF has it and
offers the reconciliation below ("Caută la ANAF", "Leagă indexul X", "Retrimite", each
write confirmed explicitly). Every submission is listed with its state, moment, index,
ANAF's messages and which one replaced it. The register shows the status of invoices and
stornos. A proforma has none of it.

### Reconciling an `unknown` submission

`unknown` means nobody can tell whether ANAF took the upload. The logic is in
`cubes/invoicing/efactura/reconciliation` (it moves submissions only through the
`submissions` unit's surface); the host's side is
`kernel/efactura/reconciliation/request-anaf.ts` and
`kernel/storage/postgres-efactura-reconciliation.ts`.

| Route | Grant | What it does |
| --- | --- | --- |
| `GET /api/efactura/submissions/{id}/candidates?page=` | `efactura:reconcile` | one page of ANAF's list for the submission's CIF and window: this CIF's own uploads only (index, ANAF's date, type, and `linked` when another submission of the organization already holds the index, read locally) |
| `POST /api/efactura/submissions/{id}/link` `{ uploadIndex, confirmed: true }` | `efactura:reconcile`, session + CSRF | links the index you confirm is this document, once the server found it in ANAF's list |
| `POST /api/efactura/submissions/{id}/resubmit` `{ confirmed: true }` | `efactura:reconcile`, session + CSRF | a new submission in place of the unknown one: `202`, or `200` with the one already made |

All three answer only for a current `unknown` submission (`409 efactura_not_unknown`
otherwise: queued, processing, accepted, or one already superseded), only with e-Factura
configured and connected for the submission's CIF (`efactura_not_configured`,
`efactura_not_connected`, `efactura_cif_mismatch`), and belong to the plugin.

**Candidates.** `listaMesajePaginatieFactura` for the submission's CIF and
environment, from the moment the submission was created, at most 60 days and never
past now, one page per call. Only the types an upload of this CIF leaves are
candidates (`FACTURA TRIMISA`, `ERORI FACTURA`): a received invoice carries someone
else's index. Nothing is opened (no ZIP) and nothing is linked. Every call is
reserved in the organization's budget (900 per minute) before it leaves, like the
dispatcher's, and logged in `efactura_submission_attempts` (`listaMesaje`); a 429
pauses the organization, a spent budget or a pause answers `409 efactura_rate_limited`,
a 401/403 answers `409 efactura_connection_refreshing` (retry once the dispatcher
refreshed), "no right" `409 efactura_no_right`, anything unclear
`409 efactura_anaf_unavailable`.

**Link.** `confirmed: true` is your statement that the index is this document;
nothing proves it, and nothing is linked without it (`400`). The server then looks
for the index itself, in ANAF's list for the submission's environment, CIF and window
(at most 10 pages, each reserved like above): an index that only answers
`stareMesaj` is not enough (`409 efactura_index_not_listed`). An index already held by
another submission of the organization and environment is refused
(`409 efactura_index_linked`; the unique index backs it). Then, in one transaction:
`unknown → processing` with the index, the document's status `processing`, and
`efactura_submission.linked` with you as the actor and the index as the reason. The
dispatcher polls it from there, like any other upload.

**Resubmit.** `confirmed: true` is your statement that the index's absence from
ANAF's list does not prove the upload never arrived, and that **ANAF may end up
holding the document twice**. The application gives no technical guarantee against
that duplicate: the resubmission is explicit, confirmed and audited, and that is
all. The XML is generated again from the frozen snapshot and passes every check of
a submit (configured, connected, issuer CIF = the connection's, at most 10 MB);
for a private buyer it goes to `uploadb2c` again. In one transaction under the submissions key: the old submission is
marked `superseded` (its state stays `unknown`; an accepted submission can never be
superseded, a CHECK enforces it), the new one is queued, `efactura_resubmissions`
records the link with you and the confirmation, the document shows `queued`, and
the audit gets `efactura_submission.resubmitted` (on the old one) and `.queued` (on
the new one). Asked again after a lost answer, or several times at once, it answers
the replacement it already made (`200`) and creates nothing. A submit of the
document then answers the new submission.

**`ANAF_ENVIRONMENT`** is checked by `serve` against the environment of the stored
submissions once the schema is ready, before any traffic and before the dispatcher,
whatever `QWBE_PLUGINS` says: `/health/ready` and `/api*` answer 503 until it
passed, so no submit can write in the startup window. Polling a `test` index
against `prod`, or the reverse, would read another system's answer, so `serve`
stops with exit 1 and says why.

**Restore.** A backup is a picture of the past: a submission it shows `queued`,
`validating` or `uploading` may have reached ANAF since. `restore` therefore runs a
fixed SQL step after the dump, inside the same `psql --single-transaction`
(`kernel/ops/efactura-restore.ts`), whatever `QWBE_PLUGINS` says: those submissions
become `unknown` ("restaurat din backup"), their documents show `unknown`, each one
gets an `efactura_submission.restored_unknown` audit row, and the OAuth attempts are
deleted. If that step fails, the whole restore rolls back with it and the database
stays empty. After a restore, reconnecting with the certificate uploads nothing.

## Facturi primite: ce a raspuns ANAF TEST (2026-10-23)

Read-only probe for the received invoices (T-2024), with the application's own
gateway and stored token (`requestAnaf`, `send`), from a throwaway script in the
`app` container; nothing was refreshed. About thirty calls in all, one `descarcare`.

**The list.** `listaMesajePaginatieFactura` answers HTTP 200, `application/json`,
in both cases below; an error is a body with `eroare`, never a status:

- with messages: `mesaje[]` plus `numar_inregistrari_in_pagina`,
  `numar_total_inregistrari_per_pagina` (500), `numar_total_inregistrari`,
  `numar_total_pagini`, `index_pagina_curenta`, `serial` (the token's
  certificate), `cui` (every CIF/CNP the certificate has a right on,
  comma-separated, not only the one asked) and `titlu` ("Lista Mesaje disponibile
  din intervalul DD-MM-YYYY HH:mm:ss - …", Bucharest time);
- with none: only `{"eroare":"Nu exista mesaje in intervalul selectat","titlu":"Lista Mesaje"}`.

A page is **not** filled up to the 500 it announces: 24 messages over 60 days came
as page 1 with 11 and page 2 with 13 (`numar_total_pagini: 2`), apparently split by
ANAF's id range (`3059…` on one page, `3057…` on the other), not by date. A reader walks `pagina` up to `numar_total_pagini` and never
infers the number of pages from the count.

A message is `{ data_creare, cif, id_solicitare, detalii, tip, id }`, all strings;
`data_creare` is `YYYYMMDDHHmm`, Bucharest time.

**`filtru`.** Without it every type comes back. `T` gave only `FACTURA TRIMISA`,
`P` only `FACTURA PRIMITA`; `E` and `R` were accepted and answered "Nu exista
mesaje": this CIF has no errors and no buyer messages, so what they hold was not seen.

**A received invoice.** There was none, so an invoice was issued in the application
to a customer with the issuer's own CIF and sent to ANAF TEST (`upload`, `UBL`).
It was `accepted` at the first `stareMesaj`; about 17 minutes later the list held
two messages for it, with the same `data_creare` (the moment they were listed, not
the upload):

| `tip` | `id` | `id_solicitare` | `cif` |
| --- | --- | --- | --- |
| `FACTURA TRIMISA` | the `id_descarcare` `stareMesaj` gave | the upload index | the CIF asked |
| `FACTURA PRIMITA` | another id, its own | **the same upload index** (the supplier's) | the CIF asked |

`detalii` of both: `Factura cu id_incarcare=<index> emisa de cif_emitent=<CIF>
pentru cif_beneficiar=<CIF>`. So a received invoice is `tip: "FACTURA PRIMITA"`,
its `id` is what `descarcare` takes and is unique, and `id_solicitare` is the
supplier's upload index, not ours: it does not identify the message. Since issuer and
buyer were the same CIF here, the probe cannot tell whether `cif` on a received
message from a third party is the buyer (us) or the supplier; the supplier's CIF is
read from `detalii` or from the XML. For a B2C upload `detalii` is a different
sentence ("… nu poate fi comunicata catre destinatar (BT-47 lipsa identificator
sau factura raportata in relatia B2C) …").

**The window.** `startTime` older than 60 days **before the moment of the request**
is refused, whatever the window's length: 70→0, 70→10 and 61→0 days all answered
`{"eroare":"startTime = 14-08-2026 14:32:33 nu poate fi mai vechi de 60 de zile fata de momentul requestului = 23-10-2026 14:32:34","titlu":"Lista Mesaje"}`,
60→0 is accepted. ANAF does not cut the window: through this list, a message older
than 60 days can no longer be found.

**The ZIP** of `descarcare` for the `FACTURA PRIMITA` id is byte for byte the ZIP of
the `FACTURA TRIMISA` id (same SHA-256): two entries, in this order,
`semnatura_<index>.xml` (XMLDSig by `CN=ANAF TEST`, `DigestValue` = SHA-256 of the
invoice XML) and `<index>.xml` (the uploaded XML, byte for byte). Both deflate,
general flags `0x0808` (data descriptor + UTF-8 names): the local headers carry CRC
and sizes **0**, the real values follow the data in a `PK\x07\x08` descriptor and
in the central directory. Version 20, no extra fields, no comments, one disk, no
ZIP64. The invoice XML: UTF-8 without BOM, root `Invoice`, default namespace
`urn:oasis:names:specification:ubl:schema:xsd:Invoice-2` with prefixes `cac`/`cbc`
on the standard UBL URIs, no comment, no CDATA, no DOCTYPE. It is this
application's own XML; another program's XML may differ.

**Fixture.** `cubes/invoicing/efactura/fixtures/anaf-test-received-invoice.zip` is
that ZIP with the parties anonymised: names, address, CIF (`19999927`), trade
registry number and document number replaced in the invoice XML, which was
recompressed in exactly ANAF's layout (rebuilt unchanged, the writer gives back
ANAF's bytes). The signature entry is ANAF's, untouched, so its `DigestValue` no
longer matches the anonymised XML.

## What is still unverified

- The official `ro16931-ubl-1.0.9` package is **not** reachable over HTTP from
  here (`mfinante.gov.ro` resets the connection, repeatedly, across sessions);
  the national rules were read from an extracted copy of that package kept
  outside this repository. The national
  rules in `cius-limits.ts` were read from its flattened
  `preprocessed/ROeFactura-UBL-validation-Invoice_v1.0.8.sch`; the EN 16931
  rules still come from the abstract model files and the validator's own
  responses. Nothing here executes the Schematron: there is no XSLT engine in
  this environment, so a rule no fixture exercises is still a rule nobody has
  run.
- **Two BT-22 notes are accepted by the SPV on ANAF TEST** (2026-10-20), not only
  by the validator. Both documents submitted that day carried two notes and
  reached `accepted`: the invoice (`FACT1`) the Article 310 legal note plus the
  seller's remarks, the shape of fixture 10; the storno (`FCN`, CreditNote 381)
  the Article 310 legal note plus the storno reason, the shape of fixture 09.
  Fixtures 09 and 10 themselves were not uploaded. Fixtures 01–08 regenerate
  byte for byte identical after T-1383 and after the move to two notes, so what
  ANAF did accept has not drifted.
- **B2C is accepted by the SPV on ANAF TEST** (2026-10-20). An invoice to a
  private person without a CNP (`HINT 2`, BT-47 `0000000000000`, no
  `PartyTaxScheme`) went to `uploadb2c` and reached `accepted` at the first
  `stareMesaj`, with no `Errors` in any answer (`validare`, upload,
  `stareMesaj`). ANAF's ZIP holds the submitted XML byte for byte plus its
  signature (`CN=ANAF TEST`, digest = the SHA-256 of that XML). The feared "nu
  poate fi comunicata catre destinatar (BT-47-lipsa identificator)" did not come
  back as an error, so the answers are read exactly as for B2B. The same day an
  invoice to a company (`HINT 1`) went to `upload` and was accepted the same way.
  The two other private-person cases were accepted the same way, also at the
  first `stareMesaj` and with no `Errors`: an invoice to a private person
  identified by a CNP (`HINT 3`, a synthetic valid CNP in BT-47) and the storno
  of `HINT 2` (`HINT 4`, CreditNote 381 with `standard=CN` on `uploadb2c`, BT-47
  `0000000000000`, billing reference `HINT 2`). Each ZIP again held the
  submitted XML byte for byte, signed by `CN=ANAF TEST`, and the CNP did not
  reach the stored errors, the audit or the logs.
- The validator checks schema and Schematron. It does not check that the
  document states the truth: correct totals with the wrong VAT category pass.
- Nothing has been sent to the production SPV yet; the documents below went to
  ANAF TEST only.
- `validare` is not served by ANAF TEST (404 with a token, 401 without, checked
  2026-10-20); the dispatcher uses the public production validator, without a
  token, whose answer for fixtures 05 and 06 was `{"stare":"ok","trace_id":…}`.
  Its `nok` was seen live the same day:
  `{"stare":"nok","Messages":[{"message":"Fisierul transmis nu este valid. …"}],"trace_id":…}`,
  HTTP 200 with `Content-Type: text/plain`, like `ok`.
- The ANAF connection with the certificate was confirmed live on ANAF TEST
  (2026-10-20), without `state` and with `token_content_type=jwt`, the right on the
  CIF verified, the access token's `expires_in` 90 days. The end-to-end cycle was
  confirmed the same day, for an invoice (`UBL`, `FACT1`) and a storno (`CN`, `FCN`:
  CreditNote type 381 with a BillingReference to the invoice, positive values):
  `validare` 200 `ok` → upload 200 with an index → `stareMesaj` 200 `ok` at the first
  poll (about a minute) → `descarcare` 200 → `accepted`, the ZIP stored.
- Still unconfirmed on ANAF TEST, followed separately: PKCE (it needs a new
  connection with the certificate); the refresh token's lifetime (still taken as 365
  days); the exact text of "no right on the CIF". The reconciliation of an `unknown`
  submission runs only against the fake ANAF. The list itself was read live on
  2026-10-23 (see "Facturi primite" above); `ERORI FACTURA` was not seen there.

## Validating the fixtures

```
node scripts/efactura-fixtures.mjs          # writes .local/efactura-fixtures/*.xml
```

Upload each file at <https://www.anaf.ro/uploadxmi/>, standard `FACT1` — except
the credit notes (06, 09), which go as `FCN`.

A document issued in the running application is exported the same way, directly:

```
docker compose exec app sh -c "wget -qO- --header 'Host: invoice.test' \
  --header \"Authorization: Bearer \$(cat /run/secrets/api_token)\" \
  http://127.0.0.1:3000/api/invoices/$ID/efactura.xml" > "factura-$ID.xml"
```

The backend has no published port: the call runs inside its container, with the
Host of `PUBLIC_ORIGIN` (any other Host answers 400) and with `QWBE_BEARER_API=on`
exported before `docker compose up -d` (off, `Authorization` answers 400).

That file is uploaded at the same address and under the same rule as the
fixtures: only invented parties. A local invoice is issued against whatever
issuer profile is configured, so check who the document names before it leaves
the machine.

Only synthetic documents go there: the validator is a third-party service and an
uploaded file is out of our hands. Every identifier in the fixtures is invented
and belongs to nobody.

That rule is for the fixtures and for a manual upload. The dispatcher is
different: before every upload, on `test` and on `prod` alike, it sends the real
XML of the submission to ANAF's public validator,
`webservicesp.anaf.ro/prod/FCTEL/rest/validare`, without a token. That validator
is run by ANAF, the same operator as the SPV that receives the upload right
after, and validating registers nothing in SPV.
