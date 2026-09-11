import { ValidationFailure } from "../contracts/failures.ts"

export interface UnitOfMeasure {
  readonly code: string
  readonly name: string
}

// Only the everyday units needed for invoicing; piece and generic unit cover
// countable goods and services without packaging-specific options.
// Codes are UN/ECE Recommendation 20 rev. 3 / 21 rev. 3, as RO
// e-Factura (EN 16931 BT-130) requires; names are the Romanian labels shown in
// the UI and frozen into the document snapshot. Extend deliberately, never by
// importing the full 2,000-entry catalogue.
const curated: ReadonlyArray<UnitOfMeasure> = [
  { code: "H87", name: "bucată" },
  { code: "C62", name: "unitate" },
  { code: "HUR", name: "oră" },
  { code: "KGM", name: "kilogram" },
  { code: "LTR", name: "litru" },
  { code: "MTR", name: "metru" },
  { code: "MTK", name: "metru pătrat" },
  { code: "MTQ", name: "metru cub" },
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
