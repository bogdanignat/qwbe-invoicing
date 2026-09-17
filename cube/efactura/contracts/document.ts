/**
 * The normalized fiscal contract the generator renders.
 *
 * This is deliberately *not* the invoicing domain model. The host maps an
 * issued invoice or a correction into this shape; the generator never reaches
 * into invoicing, never reads a live issuer profile, and never recomputes an
 * amount. Every number here is already the frozen snapshot value, as a decimal
 * string, in the semantics UBL expects — positive, even for a credit note.
 *
 * Field comments carry the EN 16931 business term (BT/BG) each value feeds, so
 * a mapping question can be answered against the standard rather than guessed.
 */

/** BT-3 document type: a commercial invoice (380) or a credit note (381). */
export type EFacturaDocumentKind = "invoice" | "credit_note"

/**
 * UNCL5305 VAT category.
 *
 * - `S` — standard or reduced rated, positive percentage.
 * - `E` — exempt with a zero percentage. ANAF recommends it for the travel
 *   agent margin scheme (VATEX-EU-309), not for unregistered issuers.
 * - `O` — not subject to VAT, carrying **no** percentage at all. ANAF's
 *   technical recommendation assigns this to supplies by taxable persons not
 *   registered for VAT, with BT-121 = `VATEX-EU-O` and the Article 310
 *   reference placed in BT-22. See docs/EFACTURA.md.
 *
 * The distinction is structural, not cosmetic: `E` requires a zero percent,
 * `O` requires its absence, so the two render different XML.
 */
export type EFacturaVatCategory = "S" | "E" | "O"

export interface EFacturaAddress {
  /** BT-40 / BT-55 — ISO 3166-1 alpha-2. */
  readonly countryCode: string
  /** BT-37 / BT-52 — for Bucharest this carries the sector, not the city name. */
  readonly cityName: string
  /** BT-35 / BT-50 */
  readonly streetName: string
  /** BT-39 / BT-54 — ISO 3166-2 subdivision code, e.g. `RO-CJ`. */
  readonly countrySubentity: string
  /** BT-38 / BT-53 — optional in CIUS-RO. */
  readonly postalZone: string | null
}

export interface EFacturaParty {
  /** BT-27 / BT-44 — the registered legal name. */
  readonly registrationName: string
  readonly address: EFacturaAddress
  /** BT-31 / BT-48 — VAT identifier including the country prefix (`RO123…`),
   * present only when the party is actually VAT registered. */
  readonly vatIdentifier: string | null
  /** BT-32 — seller tax registration identifier, the alternative BR-RO-065
   * accepts when there is no VAT identifier (Article 310 issuers). */
  readonly taxRegistrationIdentifier: string | null
  /** BT-30 / BT-47 — legal registration identifier (trade registry number). */
  readonly legalRegistrationIdentifier: string | null
}

export interface EFacturaLine {
  /** BT-126 — line identifier, unique within the document. */
  readonly id: string
  /** BT-153 — item name. */
  readonly name: string
  /** BT-129 — invoiced/credited quantity, always positive. */
  readonly quantity: string
  /** BT-130 — UN/ECE Recommendation 20/21 unit code. */
  readonly unitCode: string
  /** BT-131 — line net amount, always positive. */
  readonly netAmount: string
  /** BT-146 — item net price, always positive. */
  readonly unitPrice: string
  /** BT-151 */
  readonly vatCategory: EFacturaVatCategory
  /** BT-152 — percentage as a decimal string; `0.00` for `E`, and `null` for
   * `O`, where the standard requires the element to be absent. */
  readonly vatRate: string | null
}

export interface EFacturaTaxSubtotal {
  /** BT-116 */
  readonly taxableAmount: string
  /** BT-117 */
  readonly taxAmount: string
  /** BT-118 */
  readonly category: EFacturaVatCategory
  /** BT-119 — `null` for `O`, where the element must be absent. */
  readonly percent: string | null
  /** BT-120 — exemption reason text. Forbidden for `S` (BR-S-10). */
  readonly exemptionReason: string | null
  /** BT-121 — VATEX exemption reason code. Only ever used together with a
   * category that allows it (BR-O-10 for `O`), never with `S`. */
  readonly exemptionReasonCode: string | null
}

/** BG-3 — the invoice a credit note corrects. */
export interface EFacturaPrecedingReference {
  /** BT-25 — the original document's full number, matching its BT-1. */
  readonly id: string
  /** BT-26 */
  readonly issueDate: string
}

/**
 * BG-16 — how the buyer is expected to pay — has no field here.
 *
 * It was modelled before it could be rendered, which made the contract promise
 * an element the generator silently dropped. Nothing feeds it either: BT-81
 * (payment means code) has no source in the snapshot, and an IBAN on the issuer
 * profile is not by itself evidence of the means agreed with the buyer.
 *
 * When it does arrive it needs BT-84 as `cac:PayeeFinancialAccount/cbc:ID`,
 * BT-85 as that account's `cbc:Name` — the account name, not the bank's, which
 * the earlier shape had wrong — and BT-86 as the branch identifier. It goes
 * into the UBL sequence after the customer party and before `cac:TaxTotal`.
 */

export interface EFacturaDocument {
  readonly kind: EFacturaDocumentKind
  /** BT-1 — the document number exactly as printed on the PDF (`SERIES NUMBER`). */
  readonly id: string
  /** BT-2 */
  readonly issueDate: string
  /** BT-9 — payment due date. Never set on a credit note. */
  readonly dueDate: string | null
  /** BT-5 — ISO 4217. Only `RON` is supported today. */
  readonly currencyCode: string
  /**
   * BG-1 — the invoice notes, one `cbc:Note` each.
   *
   * BT-22 is a repeating element, and CIUS-RO limits a single occurrence to
   * 300 characters (BR-RO-L300) while allowing twenty of them (BR-RO-A020).
   * An Article 310 document states its legal ground here and a credit note
   * states why it reverses an invoice; a document that is both keeps the two
   * as two notes, because they are two statements, not one longer one.
   */
  readonly notes: ReadonlyArray<string>
  readonly precedingInvoice: EFacturaPrecedingReference | null
  readonly seller: EFacturaParty
  readonly buyer: EFacturaParty
  readonly lines: ReadonlyArray<EFacturaLine>
  readonly taxSubtotals: ReadonlyArray<EFacturaTaxSubtotal>
  /** BT-106 — sum of line net amounts. */
  readonly lineExtensionAmount: string
  /** BT-109 — total without VAT. */
  readonly taxExclusiveAmount: string
  /** BT-110 — total VAT amount. */
  readonly taxAmount: string
  /** BT-112 — total with VAT. */
  readonly taxInclusiveAmount: string
  /** BT-115 — amount due for payment. */
  readonly payableAmount: string
}
