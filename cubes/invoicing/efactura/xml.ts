import { EFacturaContractViolation } from "./contracts/failures.ts"

/**
 * A minimal XML tree. Element order is the array order, never object key order,
 * so the same document always renders to the same bytes: UBL schemas impose a
 * strict xsd:sequence and the validator hashes the exact bytes it approved.
 *
 * Content is element-only or text-only. EN 16931 has no mixed content, so the
 * renderer refuses it instead of guessing where whitespace belongs.
 */
export interface XmlElement {
  readonly name: string
  readonly attributes?: ReadonlyArray<readonly [string, string]>
  readonly children?: ReadonlyArray<XmlElement>
  readonly text?: string
}

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/

/** XML 1.0 Char production. Anything else — C0 controls, lone surrogates, the
 * non-characters U+FFFE/U+FFFF — cannot be escaped and must be rejected. */
const isAllowedCodePoint = (codePoint: number): boolean =>
  codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
  || (codePoint >= 0x20 && codePoint <= 0xd7ff)
  || (codePoint >= 0xe000 && codePoint <= 0xfffd)
  || codePoint >= 0x10000

const describe = (codePoint: number): string => `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`

const assertRenderable = (value: string, where: string, issues: Array<string>): void => {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (!isAllowedCodePoint(codePoint)) {
      issues.push(`${where} contains a character that XML 1.0 cannot represent (${describe(codePoint)})`)
      return
    }
  }
}

/** A literal carriage return does not survive parsing: XML 1.0 line-ending
 * normalization turns CR and CRLF into a single LF before an application ever
 * sees them. Escaping it keeps the text ANAF parses identical to the text the
 * invoice was issued with, instead of quietly losing a character. */
const escapeText = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\r", "&#13;")

const escapeAttribute = (value: string): string =>
  escapeText(value).replaceAll("\"", "&quot;").replaceAll("'", "&apos;")
    .replaceAll("\t", "&#9;").replaceAll("\n", "&#10;").replaceAll("\r", "&#13;")

const collect = (element: XmlElement, path: string, issues: Array<string>): void => {
  const where = `${path}/${element.name}`
  if (!NAME.test(element.name)) issues.push(`${where} is not a valid XML element name`)
  const children = element.children ?? []
  if (element.text !== undefined && children.length > 0) {
    issues.push(`${where} has both text and child elements, which EN 16931 never uses`)
  }
  if (element.text !== undefined) assertRenderable(element.text, `${where} text`, issues)
  for (const [name, value] of element.attributes ?? []) {
    if (!NAME.test(name)) issues.push(`${where}@${name} is not a valid XML attribute name`)
    assertRenderable(value, `${where}@${name}`, issues)
  }
  for (const child of children) collect(child, where, issues)
}

const renderElement = (element: XmlElement, depth: number, out: Array<string>): void => {
  const pad = "  ".repeat(depth)
  const attributes = (element.attributes ?? [])
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("")
  const children = element.children ?? []
  if (element.text !== undefined) {
    out.push(`${pad}<${element.name}${attributes}>${escapeText(element.text)}</${element.name}>`)
    return
  }
  if (children.length === 0) {
    out.push(`${pad}<${element.name}${attributes}/>`)
    return
  }
  out.push(`${pad}<${element.name}${attributes}>`)
  for (const child of children) renderElement(child, depth + 1, out)
  out.push(`${pad}</${element.name}>`)
}

/**
 * Renders a standalone XML document: declaration, no DTD, no entity
 * declarations, no processing instructions. Indentation only ever appears
 * between child elements, so no text-carrying element gains or loses
 * whitespace that a Schematron `normalize-space` test would then see.
 */
export const renderXmlDocument = (root: XmlElement): string => {
  const issues: Array<string> = []
  collect(root, "", issues)
  if (issues.length > 0) throw new EFacturaContractViolation({ issues })
  const out: Array<string> = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>"]
  renderElement(root, 0, out)
  return `${out.join("\n")}\n`
}

/** Builds an element only when the value is present and non-empty, so optional
 * BTs are omitted rather than emitted empty — an empty element is a value in
 * UBL, and an empty mandatory-if-present field fails business rules. */
export const optional = (name: string, value: string | null | undefined,
  attributes?: ReadonlyArray<readonly [string, string]>): ReadonlyArray<XmlElement> =>
  value === null || value === undefined || value.trim().length === 0
    ? []
    : [attributes === undefined ? { name, text: value } : { name, text: value, attributes }]

export const element = (name: string, children: ReadonlyArray<XmlElement>): XmlElement => ({ name, children })

export const text = (name: string, value: string,
  attributes?: ReadonlyArray<readonly [string, string]>): XmlElement =>
  attributes === undefined ? { name, text: value } : { name, text: value, attributes }
