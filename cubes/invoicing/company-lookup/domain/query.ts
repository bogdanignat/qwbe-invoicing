import { ValidationFailure } from "../../contracts/failures.ts"
import { isValidRomanianCui } from "../../parties/index.ts"

/** Below these a query never leaves the application. */
export const MIN_CUI_DIGITS = 4
export const MIN_NAME_LETTERS = 6
export const MAX_NAME_LENGTH = 100

const refuse = (issue: string): never => { throw new ValidationFailure({ issues: [issue] }) }

/** Trimmed, upper-cased and without the `RO` VAT prefix: `" ro 14399840 "` is `"14399840"`. */
export const normalizeCui = (raw: string): string => raw.trim().toUpperCase().replace(/^RO\s*/u, "")

/** A CUI worth asking about: digits only, at least `MIN_CUI_DIGITS`, and a valid check digit. */
export const cuiQuery = (raw: string): string => {
  const cui = normalizeCui(raw)
  if (!/^\d+$/u.test(cui)) return refuse("cui must contain only digits")
  if (cui.length < MIN_CUI_DIGITS) return refuse(`cui must have at least ${String(MIN_CUI_DIGITS)} digits`)
  if (!isValidRomanianCui(cui)) return refuse("cui must be a valid Romanian CUI")
  return cui
}

/** A name worth searching for: trimmed, at most `MAX_NAME_LENGTH` characters, at least `MIN_NAME_LETTERS` letters. */
export const nameQuery = (raw: string): string => {
  const name = raw.trim()
  if (name.length > MAX_NAME_LENGTH) return refuse(`q must have at most ${String(MAX_NAME_LENGTH)} characters`)
  if ((name.match(/\p{L}/gu) ?? []).length < MIN_NAME_LETTERS) {
    return refuse(`q must have at least ${String(MIN_NAME_LETTERS)} letters`)
  }
  return name
}
