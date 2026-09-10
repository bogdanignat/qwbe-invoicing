import { ValidationFailure } from "../contracts/failures.ts"

export interface UnitOfMeasure {
  readonly code: string
  readonly name: string
}

// Units that actually appear on Romanian invoices, in the order a user expects
// to find them. Codes are UN/ECE Recommendation 20 rev. 3 / 21 rev. 3, as RO
// e-Factura (EN 16931 BT-130) requires; names are the Romanian labels shown in
// the UI and frozen into the document snapshot. Extend deliberately, never by
// importing the full 2,000-entry catalogue.
const curated: ReadonlyArray<UnitOfMeasure> = [
  { code: "H87", name: "bucată" },
  { code: "C62", name: "unitate" },
  { code: "HUR", name: "oră" },
  { code: "DAY", name: "zi" },
  { code: "WEE", name: "săptămână" },
  { code: "MON", name: "lună" },
  { code: "ANN", name: "an" },
  { code: "MIN", name: "minut" },
  { code: "KGM", name: "kilogram" },
  { code: "GRM", name: "gram" },
  { code: "TNE", name: "tonă" },
  { code: "LTR", name: "litru" },
  { code: "MLT", name: "mililitru" },
  { code: "MTR", name: "metru" },
  { code: "CMT", name: "centimetru" },
  { code: "MMT", name: "milimetru" },
  { code: "KMT", name: "kilometru" },
  { code: "MTK", name: "metru pătrat" },
  { code: "MTQ", name: "metru cub" },
  { code: "SET", name: "set" },
  { code: "PR", name: "pereche" },
  { code: "KWH", name: "kilowatt-oră" },
  { code: "LS", name: "sumă forfetară" },
  { code: "E48", name: "unitate de serviciu" },
  { code: "XPK", name: "pachet" },
  { code: "XBX", name: "cutie" },
]

const byCode = new Map(curated.map((unit) => [unit.code, Object.freeze({ ...unit })]))

export const unitOfMeasures: ReadonlyArray<UnitOfMeasure> = Object.freeze([...byCode.values()])

export const normalizeUnitOfMeasure = (input: UnitOfMeasure): UnitOfMeasure => {
  const issues: Array<string> = []
  if (!byCode.has(input.code)) issues.push("unitOfMeasure.code must be one of the supported UN/ECE unit codes")
  if (input.name.trim().length === 0) issues.push("unitOfMeasure.name is required")
  if (input.name !== input.name.trim()) issues.push("unitOfMeasure.name must not have surrounding whitespace")
  if (input.name.length > 100) issues.push("unitOfMeasure.name must be at most 100 characters")
  if (/\p{Cc}/u.test(input.name)) issues.push("unitOfMeasure.name must not contain control characters")
  if (issues.length > 0) throw new ValidationFailure({ issues })
  return { code: input.code, name: input.name }
}
