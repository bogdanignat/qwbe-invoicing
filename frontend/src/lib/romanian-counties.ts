/**
 * The county names behind the ISO 3166-2 codes a sealed document carries.
 *
 * `validateParty` (cube) refuses any county that is not one of these codes, so
 * every snapshot this screen reads stores `RO-B`, `RO-BT`, `RO-CJ` and never a
 * name. Printing the code would put `RO-B` on a fiscal document where the law
 * and the legacy client both read `București`, so the mapping is part of the
 * presentation rather than of the contract. An unknown code is returned as it
 * arrived: inventing a name for a code the list does not know would be worse
 * than showing what the backend actually stored.
 */
export interface RomanianCounty {
  readonly code: string
  readonly name: string
}

export const ROMANIAN_COUNTIES: ReadonlyArray<RomanianCounty> = [
  { code: "RO-AB", name: "Alba" },
  { code: "RO-AR", name: "Arad" },
  { code: "RO-AG", name: "Argeș" },
  { code: "RO-BC", name: "Bacău" },
  { code: "RO-BH", name: "Bihor" },
  { code: "RO-BN", name: "Bistrița-Năsăud" },
  { code: "RO-BT", name: "Botoșani" },
  { code: "RO-BV", name: "Brașov" },
  { code: "RO-BR", name: "Brăila" },
  { code: "RO-BZ", name: "Buzău" },
  { code: "RO-CS", name: "Caraș-Severin" },
  { code: "RO-CL", name: "Călărași" },
  { code: "RO-CJ", name: "Cluj" },
  { code: "RO-CT", name: "Constanța" },
  { code: "RO-CV", name: "Covasna" },
  { code: "RO-DB", name: "Dâmbovița" },
  { code: "RO-DJ", name: "Dolj" },
  { code: "RO-GL", name: "Galați" },
  { code: "RO-GR", name: "Giurgiu" },
  { code: "RO-GJ", name: "Gorj" },
  { code: "RO-HR", name: "Harghita" },
  { code: "RO-HD", name: "Hunedoara" },
  { code: "RO-IL", name: "Ialomița" },
  { code: "RO-IS", name: "Iași" },
  { code: "RO-IF", name: "Ilfov" },
  { code: "RO-MM", name: "Maramureș" },
  { code: "RO-MH", name: "Mehedinți" },
  { code: "RO-MS", name: "Mureș" },
  { code: "RO-NT", name: "Neamț" },
  { code: "RO-OT", name: "Olt" },
  { code: "RO-PH", name: "Prahova" },
  { code: "RO-SM", name: "Satu Mare" },
  { code: "RO-SJ", name: "Sălaj" },
  { code: "RO-SB", name: "Sibiu" },
  { code: "RO-SV", name: "Suceava" },
  { code: "RO-TR", name: "Teleorman" },
  { code: "RO-TM", name: "Timiș" },
  { code: "RO-TL", name: "Tulcea" },
  { code: "RO-VS", name: "Vaslui" },
  { code: "RO-VL", name: "Vâlcea" },
  { code: "RO-VN", name: "Vrancea" },
  { code: "RO-B", name: "București" },
]

export const romanianCountyName = (code: string): string =>
  ROMANIAN_COUNTIES.find((county) => county.code === code)?.name ?? code

export const isRomanianCountyCode = (code: string): boolean =>
  ROMANIAN_COUNTIES.some((county) => county.code === code)

export const countyRequiresSector = (county: string): boolean => county === "RO-B"
