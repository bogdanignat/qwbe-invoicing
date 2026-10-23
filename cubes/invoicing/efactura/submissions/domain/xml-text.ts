/**
 * The character level of the strict XML reader (`xml.ts`): which characters a
 * document may hold, and how text and attribute values are decoded. Only the
 * five predefined entities and character references are expanded; any other
 * `&` is refused, so nothing declared anywhere can ever be expanded.
 */
export type XmlRefusal =
  | "too_large" | "doctype" | "declaration" | "processing_instruction" | "entity" | "too_deep" | "too_many_elements" | "malformed"

export class XmlRefused extends Error {
  readonly refusal: XmlRefusal
  constructor(refusal: XmlRefusal) {
    super(refusal)
    this.refusal = refusal
  }
}

export const refuse = (refusal: XmlRefusal): never => { throw new XmlRefused(refusal) }

const PREDEFINED = new Map([["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", "\""], ["apos", "'"]])

/** Characters XML 1.0 does not allow in a document, even escaped: C0 controls other than tab, LF and CR, and U+FFFE/U+FFFF. */
export const hasForbiddenCharacter = (text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if ((code < 0x20 && code !== 0x9 && code !== 0xA && code !== 0xD) || code === 0xFFFE || code === 0xFFFF) return true
  }
  return false
}

const validCodePoint = (code: number): boolean => code === 0x9 || code === 0xA || code === 0xD
  || (code >= 0x20 && code <= 0xD7FF) || (code >= 0xE000 && code <= 0xFFFD) || (code >= 0x10000 && code <= 0x10FFFF)

const characterReference = (reference: string): string => {
  const hex = /^#x([0-9A-Fa-f]{1,6})$/u.exec(reference)?.[1]
  const decimal = /^#([0-9]{1,7})$/u.exec(reference)?.[1]
  const code = hex !== undefined ? parseInt(hex, 16) : decimal !== undefined ? parseInt(decimal, 10) : Number.NaN
  return validCodePoint(code) ? String.fromCodePoint(code) : refuse("entity")
}

/** Text and attribute values: only `&amp;`-style predefined entities and character references; any other `&` is refused. */
export const decode = (raw: string): string => raw.includes("&")
  ? raw.replace(/&([^;&<]{1,10});|&/gu, (_match, reference: string | undefined) =>
    reference === undefined ? refuse("entity") : PREDEFINED.get(reference) ?? characterReference(reference))
  : raw
