/**
 * Amounts stay the decimal strings the backend froze into the snapshot.
 *
 * Parsing them into a `number` to format them would round a fiscal total, so
 * the presentation only appends the currency the same document carries.
 */
export const money = (value: string, currency: string): string => `${value} ${currency}`

/** An absent optional field reads as a dash rather than an empty cell. */
export const orDash = (value: string | null | undefined): string =>
  value === null || value === undefined || value === "" ? "—" : value

/**
 * How a VAT treatment is named on a document, category first.
 *
 * `RO_NON_VAT` is stored with `rate: "0.00"` because the model requires a rate
 * and the tax due really is nothing (cube/invoicing/issuer/domain/vat-catalogue.ts),
 * but `0.00%` is not what the line means and not what may be printed: an
 * article 310 issuer owes the *mention of the exemption*, and the e-Factura
 * mapper drops the rate entirely for category `O`. So the category decides the
 * label and a percentage is shown only where one exists. The only categories
 * the contract admits are `S` and `O` (cube/invoicing/domain/invoice.ts:150).
 */
export const vatTreatmentLabel = (treatment: {
  readonly vatCategoryCode: string
  readonly rate: string
}): string => treatment.vatCategoryCode === "O"
  ? "Scutit TVA — art. 310"
  : `TVA ${treatment.rate}%`
