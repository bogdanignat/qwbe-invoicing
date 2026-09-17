import type { EFacturaDocument, EFacturaParty } from "./contracts/document.ts"
import { characterCount, normalizeSpace } from "./decimals.ts"

/**
 * The CIUS-RO length and occurrence limits for the elements this generator
 * emits, read from the official Schematron `ro16931-ubl-1.0.9`, file
 * `preprocessed/ROeFactura-UBL-validation-Invoice_v1.0.8.sch`.
 *
 * They are counted the way the rules count them — `string-length(
 * normalize-space(...))`, so only space, tab, CR and LF collapse or trim, and
 * characters rather than UTF-16 code units. Exceeding one is refused and never
 * truncated: a shortened fiscal text is a statement the document never made.
 *
 * Limits for elements we do not emit — allowances, charges, payment means,
 * delivery, tax representative, supporting documents — are deliberately absent
 * rather than written against nothing.
 */

/** BR-RO-A020 — BT-22 repeats, but not without end. */
const MAXIMUM_NOTES = 20

const limit = (value: string | null, maximum: number, where: string, rule: string,
  issues: Array<string>): void => {
  if (value === null) return
  if (characterCount(normalizeSpace(value)) > maximum) {
    issues.push(`${where} exceeds ${String(maximum)} characters after normalize-space (${rule})`)
  }
}

/** BT-27/BT-28 share `registrationName`, and both are limited to 200. */
const checkParty = (role: string, party: EFacturaParty, issues: Array<string>): void => {
  limit(party.registrationName, 200, `${role}.registrationName`, "BR-RO-L200", issues)
  limit(party.address.streetName, 150, `${role}.address.streetName`, "BR-RO-L150", issues)
  limit(party.address.cityName, 50, `${role}.address.cityName`, "BR-RO-L050", issues)
  limit(party.address.postalZone, 20, `${role}.address.postalZone`, "BR-RO-L020", issues)
}

export const checkCiusLimits = (document: EFacturaDocument, issues: Array<string>): void => {
  limit(document.id, 200, "id", "BR-RO-L200", issues)
  // BR-RO-010: an invoice number that names no number at all is refused before
  // any fiscal rule runs, so it is checked here rather than left to ANAF.
  if (!/[0-9]/u.test(document.id)) issues.push("id must contain at least one digit (BR-RO-010)")
  if (document.notes.length > MAXIMUM_NOTES) {
    issues.push(`a document carries at most ${String(MAXIMUM_NOTES)} notes, got `
      + `${String(document.notes.length)} (BR-RO-A020)`)
  }
  for (const [index, note] of document.notes.entries()) {
    const where = `notes[${String(index)}]`
    // Not a Schematron rule: the renderer emits `<cbc:Note></cbc:Note>` for a
    // blank string, so nothing downstream would catch a statement the caller
    // meant to make and left empty. Omitting the note says the same thing
    // honestly, so the empty one is refused rather than sent.
    if (normalizeSpace(note).length === 0) issues.push(`${where} is stated but empty; omit it instead`)
    limit(note, 300, where, "BR-RO-L300", issues)
  }
  if (document.precedingInvoice !== null) {
    limit(document.precedingInvoice.id, 200, "precedingInvoice.id", "BR-RO-L200", issues)
  }
  checkParty("seller", document.seller, issues)
  checkParty("buyer", document.buyer, issues)
  // BT-153 is the item name, which is what a line description becomes.
  for (const [index, line] of document.lines.entries()) {
    limit(line.name, 100, `lines[${String(index)}].name`, "BR-RO-L100", issues)
  }
}
