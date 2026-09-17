/**
 * The CIUS-RO profile the generator renders against.
 *
 * These values are injected rather than hard-coded because they identify the
 * rule set ANAF applies, and getting one character wrong invalidates every
 * document. Keeping them in one injected record means a correction after
 * official validation is a constant change, not a code change — and it lets a
 * fixture pin the exact profile the bytes were produced under.
 *
 * `DEFAULT_CIUS_RO_PROFILE` was confirmed on 2026-09-17: eight synthetic
 * documents rendered with exactly these values were accepted by the official
 * validator at anaf.ro/uploadxmi. See docs/EFACTURA.md.
 */
export interface EFacturaProfile {
  /** BT-24 — the specification identifier. */
  readonly customizationId: string
  /** BT-23 — the business process identifier. */
  readonly profileId: string
  /** UBL version. Omitted when null, because some CIUS profiles forbid it. */
  readonly ublVersionId: string | null
  /**
   * `cac:TaxScheme/cbc:ID` used to carry BT-32, the tax registration
   * identifier of a seller that is not registered for VAT. It must differ from
   * `VAT`, which is reserved for BT-31.
   */
  readonly nonVatTaxSchemeId: string
}

export const DEFAULT_CIUS_RO_PROFILE: EFacturaProfile = {
  customizationId: "urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1",
  profileId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
  ublVersionId: null,
  nonVatTaxSchemeId: "NOT_VAT",
}

/**
 * BT-47 for a private individual who has no usable CNP.
 *
 * BR-RO-120 requires the buyer to be identified, and the only identifier a
 * consumer has is a CNP, which this product keeps optional. The official
 * validator accepts this placeholder just as it accepts a real CNP (fixtures
 * 02 and 07, both valid on 2026-09-17), so an invoice issued without one is
 * still a valid document instead of one that cannot be sent.
 */
export const ANONYMOUS_BUYER_IDENTIFIER = "0000000000000"
