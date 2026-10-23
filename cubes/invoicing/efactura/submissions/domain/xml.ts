import { XmlRefused, decode, hasForbiddenCharacter, refuse, type XmlRefusal } from "./xml-text.ts"

export type { XmlRefusal } from "./xml-text.ts"

/**
 * A minimal, strict XML reader for ANAF's small answers (`upload`,
 * `stareMesaj`) and, with wider limits, for the invoices other programs wrote.
 * It accepts elements, attributes, text, the five predefined entities and
 * character references, and nothing else: no DOCTYPE, so no entity can be
 * declared or expanded; no processing instructions; no comments or CDATA unless
 * `XmlOptions` says so; bounded size, depth, element and attribute counts.
 * Whatever it does not understand is refused, never guessed.
 */
export interface XmlElement {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: ReadonlyArray<XmlElement>
  readonly text: string
}

export interface XmlLimits {
  readonly maxChars: number
  readonly maxDepth: number
  readonly maxElements: number
  readonly maxAttributes: number
}

export const ANAF_XML_LIMITS: XmlLimits = { maxChars: 256 * 1024, maxDepth: 16, maxElements: 2_000, maxAttributes: 32 }

export type XmlParse = { readonly ok: true; readonly root: XmlElement } | { readonly ok: false; readonly refusal: XmlRefusal }

/**
 * Off by default, so ANAF's own answers stay strict. On, for XML another
 * program wrote: a comment is skipped and a CDATA section is read as plain
 * text. A DOCTYPE, an entity or a processing instruction stays refused either way.
 */
export interface XmlOptions {
  readonly commentsAndCdata?: boolean
}

const NAME = /[A-Za-z_][\w.:-]*/uy
const ATTRIBUTE = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/uy
const TAG_END = /\s*(\/?)>/uy
const CLOSE = /<\/([A-Za-z_][\w.:-]*)\s*>/uy
const DECLARATION = /^<\?xml\s[^<>]*?\?>/u

const matchAt = (pattern: RegExp, source: string, at: number): RegExpExecArray | null => {
  pattern.lastIndex = at
  return pattern.exec(source)
}

interface Building {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: Array<XmlElement>
  text: string
}

/** Past a comment (skipped) or a CDATA section (its text, as written, added to the open element); `undefined` at anything else. */
const skipSection = (source: string, at: number, parent: Building | undefined): number | undefined => {
  const comment = source.startsWith("<!--", at)
  if (!comment && !source.startsWith("<![CDATA[", at)) return undefined
  const from = at + (comment ? 4 : 9)
  const end = source.indexOf(comment ? "-->" : "]]>", from)
  if (end === -1) return refuse("malformed")
  if (!comment) {
    if (parent === undefined) return refuse("malformed")
    parent.text += source.slice(from, end)
  }
  return end + 3
}

const read = (input: string, limits: XmlLimits, options: XmlOptions): XmlElement => {
  if (input.length > limits.maxChars) refuse("too_large")
  if (hasForbiddenCharacter(input)) refuse("malformed")
  const source = input.startsWith("\uFEFF") ? input.slice(1) : input
  const declaration = DECLARATION.exec(source)?.[0]
  const encoding = /encoding\s*=\s*["']([^"']*)["']/u.exec(declaration ?? "")?.[1]
  if (encoding !== undefined && !/^utf-?8$/iu.test(encoding)) refuse("malformed")
  const stack: Array<Building> = []
  let root: XmlElement | undefined
  let elements = 0
  let at = declaration?.length ?? 0

  const attach = (element: XmlElement) => {
    const parent = stack.at(-1)
    if (parent !== undefined) parent.children.push(element)
    else if (root === undefined) root = element
    else refuse("malformed")
  }

  while (at < source.length) {
    const open = source.indexOf("<", at)
    const text = source.slice(at, open === -1 ? source.length : open)
    const parent = stack.at(-1)
    if (parent !== undefined) parent.text += decode(text)
    else if (text.trim() !== "") refuse("malformed")
    if (open === -1) break
    at = open
    const skipped = options.commentsAndCdata === true ? skipSection(source, at, parent) : undefined
    if (skipped !== undefined) {
      at = skipped
      continue
    }
    if (source.startsWith("<!DOCTYPE", at)) refuse("doctype")
    if (source.startsWith("<!", at)) refuse("declaration")
    if (source.startsWith("<?", at)) refuse("processing_instruction")
    if (source.startsWith("</", at)) {
      const close = matchAt(CLOSE, source, at)
      const element = stack.pop()
      if (close === null || element === undefined || close[1] !== element.name) return refuse("malformed")
      attach(element)
      at = CLOSE.lastIndex
      continue
    }
    const name = matchAt(NAME, source, at + 1)?.[0] ?? refuse("malformed")
    const attributes = new Map<string, string>()
    let cursor = at + 1 + name.length
    for (let attribute = matchAt(ATTRIBUTE, source, cursor); attribute !== null; attribute = matchAt(ATTRIBUTE, source, cursor)) {
      const key = attribute[1] ?? ""
      if (attributes.has(key) || attributes.size >= limits.maxAttributes) refuse("malformed")
      attributes.set(key, decode(attribute[2] ?? attribute[3] ?? ""))
      cursor = ATTRIBUTE.lastIndex
    }
    const end = matchAt(TAG_END, source, cursor) ?? refuse("malformed")
    elements += 1
    if (elements > limits.maxElements) refuse("too_many_elements")
    if (stack.length >= limits.maxDepth) refuse("too_deep")
    const element: Building = { name, attributes: Object.fromEntries(attributes), children: [], text: "" }
    if (end[1] === "/") attach(element)
    else stack.push(element)
    at = TAG_END.lastIndex
  }
  if (stack.length > 0) refuse("malformed")
  return root ?? refuse("malformed")
}

export const parseStrictXml = (source: string, limits: XmlLimits = ANAF_XML_LIMITS, options: XmlOptions = {}): XmlParse => {
  try {
    return { ok: true, root: read(source, limits, options) }
  } catch (error) {
    if (error instanceof XmlRefused) return { ok: false, refusal: error.refusal }
    throw error
  }
}

/** A name without its namespace prefix: ANAF's answers use a default namespace, but nothing here depends on it. */
export const localName = (name: string): string => name.slice(name.indexOf(":") + 1)

export const childrenNamed = (element: XmlElement, local: string): ReadonlyArray<XmlElement> =>
  element.children.filter((child) => localName(child.name) === local)
