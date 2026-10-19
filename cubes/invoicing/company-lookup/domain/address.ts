import { ROMANIAN_COUNTIES, isRomanianCountyCode, romanianCountyName } from "../../parties/index.ts"

/** Only what the provider states for certain; a field it leaves empty or unclear stays absent. */
export interface ProposedAddress {
  readonly county?: string
  readonly sector?: number
  readonly city?: string
  readonly street?: string
  readonly postalCode?: string
  /** openapi.ro's single address line, shown as is: city and street are left to the user. */
  readonly original?: string
}

const BUCHAREST = "RO-B"

/** Trimmed text, or `undefined` for missing, `null` and blank. */
export const present = (value: string | null | undefined): string | undefined => {
  const text = value?.trim() ?? ""
  return text === "" ? undefined : text
}

/** ANAF's two-letter car code (`"SB"`, `"B"`) as the ISO county code. */
export const countyFromCarCode = (code: string | null | undefined): string | undefined => {
  const county = `RO-${present(code)?.toUpperCase() ?? ""}`
  return isRomanianCountyCode(county) ? county : undefined
}

// Diacritics (comma or cedilla), case, hyphens and the "Județul"/"Municipiul" prefix do not tell counties apart.
const comparable = (name: string): string => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/[-\s]+/gu, " ").trim().replace(/^(?:judetul|judet|municipiul|mun\.?)\s+/u, "")
const countiesByName = new Map(ROMANIAN_COUNTIES.map((county) => [comparable(county.name), county.code]))

/** A county name as openapi.ro writes it (`"Bistrița-Năsăud"`, `"Municipiul Bucureşti"`), when it matches exactly one county. */
export const countyFromName = (name: string | null | undefined): string | undefined => {
  const text = present(name)
  return text === undefined ? undefined : countiesByName.get(comparable(text))
}

/** The sector of a Bucharest locality ANAF writes as `"Sector 6 Mun. Bucureşti"`; anything else is not a sector. */
export const sectorFromLocality = (locality: string | undefined): number | undefined => {
  const match = /^sector(?:ul)?\s*([1-6])\b/iu.exec(locality ?? "")
  return match === null ? undefined : Number(match[1])
}

/**
 * Six digits, or absent. Bucharest codes start with 0, and ANAF's data has a
 * five-digit text for some of them ("60787"): that is the same code without the zero.
 */
export const postalCode = (value: string | null | undefined, county: string | undefined): string | undefined => {
  const code = present(value)
  if (code === undefined) return undefined
  if (/^\d{6}$/u.test(code)) return code
  return county === BUCHAREST && /^\d{5}$/u.test(code) ? `0${code}` : undefined
}

/** In Bucharest the city is the municipality itself; the sector carries the rest. */
export const cityOf = (county: string | undefined, locality: string | undefined): string | undefined =>
  county === BUCHAREST ? romanianCountyName(BUCHAREST) : locality

export const isBucharest = (county: string | undefined): boolean => county === BUCHAREST

/** Drops the fields left `undefined`, so an absent field is absent rather than present-and-undefined. */
export const compact = <Value extends object>(value: { readonly [Key in keyof Value]?: Value[Key] | undefined }): Value =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Value
