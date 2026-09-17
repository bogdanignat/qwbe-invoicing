import type { EFacturaDocument } from "./contracts/document.ts"
import { normalizeSpace } from "./decimals.ts"

/**
 * The EN 16931 code lists this generator can actually violate, copied verbatim
 * from `ro16931-ubl-1.0.9`, file
 * `preprocessed/EN16931-UBL-validation-preprocessed.sch`.
 *
 * A code list is not a shape: `XX` is two capital letters and no country, and
 * an invented VATEX code reads like a legal ground while naming none. Both are
 * fatal at ANAF, so they are refused here by name instead.
 *
 * Only the lists reachable from what we emit are here. Unit codes are not:
 * BR-CL-23 stays unchecked because the invoicing host picks the code from a
 * closed catalogue of eight, each verified against the official list. That is
 * a guarantee of the host, not of this cube — a caller that builds an
 * `EFacturaDocument` itself can still name a unit ANAF has never heard of.
 *
 * The comparisons follow each rule exactly. BR-CL-22 folds case before it
 * looks the code up, so `vatex-eu-o` is the same code to ANAF; BR-CL-14 and
 * the national lists do not fold, so `ro` is not `RO` and `de` is not `DE`.
 */

/** BR-CL-14 — ISO 3166-1 alpha-2 as EN 16931 publishes it, which is why `1A`
 * (Kosovo) and `XI` (Northern Ireland) belong here and `UK` does not. */
const COUNTRY_CODES = new Set([
  "1A", "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX",
  "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR",
  "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM",
  "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC",
  "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE",
  "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK",
  "HM", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE",
  "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB",
  "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH",
  "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF",
  "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU",
  "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR",
  "SS", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN",
  "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG",
  "VI", "VN", "VU", "WF", "WS", "XI", "YE", "YT", "ZA", "ZM", "ZW"
])

/** BR-CL-22 — the VATEX list for BT-121. `VATEX-EU-O` is the one this product
 * issues; the rest exist because the cube renders the standard, not the
 * subset. */
const VATEX_CODES = new Set([
  "VATEX-EU-79-C", "VATEX-EU-132", "VATEX-EU-132-1A", "VATEX-EU-132-1B", "VATEX-EU-132-1C",
  "VATEX-EU-132-1D", "VATEX-EU-132-1E", "VATEX-EU-132-1F", "VATEX-EU-132-1G", "VATEX-EU-132-1H",
  "VATEX-EU-132-1I", "VATEX-EU-132-1J", "VATEX-EU-132-1K", "VATEX-EU-132-1L", "VATEX-EU-132-1M",
  "VATEX-EU-132-1N", "VATEX-EU-132-1O", "VATEX-EU-132-1P", "VATEX-EU-132-1Q", "VATEX-EU-143",
  "VATEX-EU-143-1A", "VATEX-EU-143-1B", "VATEX-EU-143-1C", "VATEX-EU-143-1D", "VATEX-EU-143-1E",
  "VATEX-EU-143-1F", "VATEX-EU-143-1FA", "VATEX-EU-143-1G", "VATEX-EU-143-1H", "VATEX-EU-143-1I",
  "VATEX-EU-143-1J", "VATEX-EU-143-1K", "VATEX-EU-143-1L", "VATEX-EU-309", "VATEX-EU-148",
  "VATEX-EU-148-A", "VATEX-EU-148-B", "VATEX-EU-148-C", "VATEX-EU-148-D", "VATEX-EU-148-E",
  "VATEX-EU-148-F", "VATEX-EU-148-G", "VATEX-EU-151", "VATEX-EU-151-1A", "VATEX-EU-151-1AA",
  "VATEX-EU-151-1B", "VATEX-EU-151-1C", "VATEX-EU-151-1D", "VATEX-EU-151-1E", "VATEX-EU-G",
  "VATEX-EU-O", "VATEX-EU-IC", "VATEX-EU-AE", "VATEX-EU-D", "VATEX-EU-F", "VATEX-EU-I",
  "VATEX-EU-J"
])

/**
 * BR-CO-09 — a VAT identifier opens with the prefix of the country that issued
 * it, which is the ISO list plus `EL`: Greece registers for VAT under a prefix
 * that is not its own country code.
 *
 * The rule reads the first two characters of the element as written, with
 * neither `normalize-space` nor `upper-case`, so `ro19999919` names no country
 * to ANAF even though `RO19999919` does. Our test is the stricter one: the rule
 * asks whether those two characters appear anywhere in the list, which a single
 * letter also satisfies, while a prefix has to be a whole entry here.
 */
const VAT_PREFIXES = new Set([...COUNTRY_CODES, "EL"])

export const checkCodelists = (document: EFacturaDocument, issues: Array<string>): void => {
  for (const [role, party] of [["seller", document.seller], ["buyer", document.buyer]] as const) {
    if (!COUNTRY_CODES.has(normalizeSpace(party.address.countryCode))) {
      issues.push(`${role}.address.countryCode must be an ISO 3166-1 alpha-2 code from the EN 16931 `
        + `list, got "${party.address.countryCode}" (BR-CL-14)`)
    }
    // BT-31/BT-48 only: BT-32 is rendered under a different tax scheme, and the
    // rule's context is the `VAT` scheme alone.
    const vat = party.vatIdentifier
    if (vat !== null && vat.trim().length > 0 && !VAT_PREFIXES.has(vat.slice(0, 2))) {
      issues.push(`${role}.vatIdentifier must begin with the country prefix that issued it `
        + `(uppercase, "EL" for Greece), got "${vat}" (BR-CO-09)`)
    }
  }
  for (const [index, subtotal] of document.taxSubtotals.entries()) {
    const code = subtotal.exemptionReasonCode
    if (code === null || code.trim().length === 0) continue
    // BR-CL-22 alone tests `normalize-space(upper-case(.))`, so refusing a
    // lower-case VATEX code would refuse one the validator accepts.
    if (!VATEX_CODES.has(normalizeSpace(code).toUpperCase())) {
      issues.push(`taxSubtotals[${String(index)}].exemptionReasonCode must be a VATEX code, `
        + `got "${code}" (BR-CL-22)`)
    }
  }
}
