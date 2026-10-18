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

const countyNames = new Map(ROMANIAN_COUNTIES.map((county) => [county.code, county.name]))

export const isRomanianCountyCode = (value: string): boolean => countyNames.has(value)
export const romanianCountyName = (code: string): string | undefined => countyNames.get(code)
