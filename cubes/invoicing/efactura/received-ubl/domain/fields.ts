import { isCalendarDate } from "../../decimals.ts"
import type { Amount, ItemCode, Quantity } from "./document.ts"
import { all, one, refuseField, type UblNode } from "./xml-tree.ts"

/**
 * The values of a UBL element: text without the XML whitespace around it (an
 * empty element is absent), decimals kept exactly as written once they are
 * checked to be `xs:decimal`, amounts with their `currencyID`, dates as
 * `YYYY-MM-DD`. A value that is present and wrong is refused with its path.
 */
const XML_SPACE = /^[\t\n\r ]+|[\t\n\r ]+$/gu
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u
const CURRENCY = /^[A-Z]{3}$/u

type Defined<T> =
  & { [K in keyof T as undefined extends T[K] ? never : K]: T[K] }
  & { [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined> }

/** The object without its undefined properties: an absent field stays absent, not present and undefined. */
export const defined = <T extends object>(value: T): Defined<T> =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Defined<T>

export const textOf = (node: UblNode | undefined): string | undefined => {
  const text = node?.text.replace(XML_SPACE, "")
  return text === "" ? undefined : text
}

export const optionalText = (node: UblNode, path: string): string | undefined => textOf(one(node, path))

export const requiredText = (node: UblNode, path: string): string => optionalText(node, path) ?? refuseField("missing", path)

/** Every non-empty text at the path, in document order. */
export const texts = (node: UblNode, path: string): ReadonlyArray<string> =>
  all(node, path).flatMap((found) => textOf(found) ?? [])

/** An `xs:decimal` as money.ts reads it: no `+`, no bare `.5` or `5.`. */
export const computable = (value: string): string => value.replace(/^\+/u, "").replace(/^(-?)\./u, "$10.").replace(/\.$/u, "")

export const optionalDecimal = (node: UblNode, path: string): string | undefined => {
  const value = optionalText(node, path)
  return value === undefined || DECIMAL.test(value) ? value : refuseField("invalid", path)
}

export const optionalDate = (node: UblNode, path: string): string | undefined => {
  const value = optionalText(node, path)
  return value === undefined || isCalendarDate(value) ? value : refuseField("invalid", path)
}

export const requiredDate = (node: UblNode, path: string): string => optionalDate(node, path) ?? refuseField("missing", path)

const currency = (code: string, path: string): string => CURRENCY.test(code) ? code : refuseField("invalid", path)

export const optionalCurrency = (node: UblNode, path: string): string | undefined => {
  const code = optionalText(node, path)
  return code === undefined ? undefined : currency(code, path)
}

export const requiredCurrency = (node: UblNode, path: string): string => optionalCurrency(node, path) ?? refuseField("missing", path)

export const optionalAmount = (node: UblNode, path: string): Amount | undefined => {
  const value = optionalDecimal(node, path)
  if (value === undefined) return undefined
  const code = one(node, path)?.attributes.currencyID
  const where = `${path}@currencyID`
  return { value, currency: code === undefined ? refuseField("missing", where) : currency(code, where) }
}

export const requiredAmount = (node: UblNode, path: string): Amount => optionalAmount(node, path) ?? refuseField("missing", path)

export const optionalQuantity = (node: UblNode, path: string): Quantity | undefined => {
  const value = optionalDecimal(node, path)
  return value === undefined ? undefined : defined({ value, unit: one(node, path)?.attributes.unitCode })
}

/** A code and the attribute naming its scheme (`schemeID`, `listID`). */
export const codeOf = (node: UblNode, attribute: string): ItemCode | undefined => {
  const value = textOf(node)
  return value === undefined ? undefined : defined({ value, scheme: node.attributes[attribute] })
}
