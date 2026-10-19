/**
 * The check digit of a Romanian CUI, the same rule the backend applies
 * (`cubes/invoicing/parties/domain/party-validation.ts`): 2 to 10 digits, no
 * leading zero, and a last digit that matches the weighted sum of the rest.
 * The browser asks it before a company lookup, so a mistyped CUI never leaves.
 */
const WEIGHTS = "753217532"

export const isValidRomanianCui = (value: string): boolean => {
  if (!/^[1-9]\d{1,9}$/u.test(value)) return false
  const body = value.slice(0, -1)
  const offset = WEIGHTS.length - body.length
  let sum = 0
  for (let index = 0; index < body.length; index += 1) {
    sum += Number(body[index]) * Number(WEIGHTS[offset + index])
  }
  const remainder = (sum * 10) % 11
  return Number(value.at(-1)) === (remainder === 10 ? 0 : remainder)
}
