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

/** BR-RO-110 — the ISO 3166-2:RO code list, copied from the Schematron rather
 * than matched by shape: `RO-XX` looks like a county and is not one. */
const ROMANIAN_COUNTIES = new Set(["RO-AB", "RO-AG", "RO-AR", "RO-B", "RO-BC", "RO-BH", "RO-BN",
  "RO-BR", "RO-BT", "RO-BV", "RO-BZ", "RO-CJ", "RO-CL", "RO-CS", "RO-CT", "RO-CV", "RO-DB", "RO-DJ",
  "RO-GJ", "RO-GL", "RO-GR", "RO-HD", "RO-HR", "RO-IF", "RO-IL", "RO-IS", "RO-MH", "RO-MM", "RO-MS",
  "RO-NT", "RO-OT", "RO-PH", "RO-SB", "RO-SJ", "RO-SM", "RO-SV", "RO-TL", "RO-TM", "RO-TR", "RO-VL",
  "RO-VN", "RO-VS"])

/** BR-RO-100 — in Bucharest the sector *is* the city-level unit, so BT-37/BT-52
 * carries a sector code and never the city name. */
const BUCHAREST_SECTORS = new Set(["SECTOR1", "SECTOR2", "SECTOR3", "SECTOR4", "SECTOR5", "SECTOR6"])

/**
 * The two national address rules, which only apply to a Romanian address.
 *
 * A foreign address keeps whatever its own country uses; these rules are
 * conditioned on BT-40/BT-55 being `RO` in the Schematron too.
 */
const checkRomanianAddress = (role: string, party: EFacturaParty, issues: Array<string>): void => {
  const { countryCode, countrySubentity, cityName } = party.address
  if (countryCode !== "RO") return
  if (!ROMANIAN_COUNTIES.has(normalizeSpace(countrySubentity))) {
    issues.push(`${role}.address.countrySubentity must be an ISO 3166-2:RO code such as RO-CJ, `
      + `got "${countrySubentity}" (BR-RO-110)`)
    return
  }
  if (normalizeSpace(countrySubentity) === "RO-B" && !BUCHAREST_SECTORS.has(normalizeSpace(cityName))) {
    issues.push(`${role}.address.cityName must be SECTOR1..SECTOR6 for RO-B, got "${cityName}" (BR-RO-100)`)
  }
}

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
  checkRomanianAddress(role, party, issues)
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
