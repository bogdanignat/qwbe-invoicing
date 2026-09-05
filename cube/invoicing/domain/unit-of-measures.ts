import { REC_20_3, REC_21_3 } from "un-ece-recommendation"

import { ValidationFailure } from "../contracts/failures.ts"

export interface UnitOfMeasure {
  readonly code: string
  readonly name: string
}

const byCode = new Map<string, UnitOfMeasure>()
for (const entry of [...REC_20_3, ...REC_21_3]) {
  if (entry.name === undefined || byCode.has(entry.code)) continue
  byCode.set(entry.code, Object.freeze({ code: entry.code, name: entry.name }))
}

export const unitOfMeasures: ReadonlyArray<UnitOfMeasure> = Object.freeze(
  [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code)),
)

export const normalizeUnitOfMeasure = (input: UnitOfMeasure): UnitOfMeasure => {
  const issues: Array<string> = []
  if (!byCode.has(input.code)) issues.push("unitOfMeasure.code must be a valid UN/ECE Recommendation 20 or 21 code")
  if (input.name.trim().length === 0) issues.push("unitOfMeasure.name is required")
  if (input.name !== input.name.trim()) issues.push("unitOfMeasure.name must not have surrounding whitespace")
  if (input.name.length > 100) issues.push("unitOfMeasure.name must be at most 100 characters")
  if (/\p{Cc}/u.test(input.name)) issues.push("unitOfMeasure.name must not contain control characters")
  if (issues.length > 0) throw new ValidationFailure({ issues })
  return { code: input.code, name: input.name }
}
