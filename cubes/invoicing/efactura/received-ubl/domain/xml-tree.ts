import type { XmlElement } from "../../submissions/index.ts"
import type { ReadFailure } from "./document.ts"

/**
 * The parsed XML with every element's namespace resolved from the `xmlns` and
 * `xmlns:p` declarations in scope, so a reader asks for `cbc:ID` by namespace
 * URI whatever prefix the writer chose, and an element with the right local name
 * in another namespace is simply not there. Paths are written with the UBL
 * prefixes `cac`/`cbc`; each step asks for the element's cardinality: `all` for
 * many, `one` refuses a second occurrence instead of picking one.
 */
export interface UblNode {
  readonly namespace: string | undefined
  readonly local: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: ReadonlyArray<UblNode>
  readonly text: string
}

export const INVOICE_NS = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
export const CREDIT_NOTE_NS = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
const PATH_PREFIXES: Readonly<Record<string, string>> = {
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
}

export class UblRefused extends Error {
  readonly failure: ReadFailure
  constructor(failure: ReadFailure) {
    super(failure.reason)
    this.failure = failure
  }
}

export const refuseField = (reason: "unbound_prefix" | "missing" | "duplicate" | "invalid", field: string): never => {
  throw new UblRefused({ reason, field })
}

const XMLNS = "xmlns"

/** Declarations on this element, over its parent's scope; `""` is the default namespace. */
const scopeOf = (element: XmlElement, parent: ReadonlyMap<string, string>): ReadonlyMap<string, string> => {
  const declared = Object.entries(element.attributes).filter(([key]) => key === XMLNS || key.startsWith(`${XMLNS}:`))
  if (declared.length === 0) return parent
  const scope = new Map(parent)
  for (const [key, uri] of declared) scope.set(key === XMLNS ? "" : key.slice(XMLNS.length + 1), uri)
  return scope
}

const resolve = (element: XmlElement, parent: ReadonlyMap<string, string>): UblNode => {
  const scope = scopeOf(element, parent)
  const colon = element.name.indexOf(":")
  const prefix = colon === -1 ? "" : element.name.slice(0, colon)
  const namespace = scope.get(prefix)
  if (colon !== -1 && (namespace === undefined || namespace === "")) refuseField("unbound_prefix", element.name)
  return {
    namespace: namespace === "" ? undefined : namespace,
    local: element.name.slice(colon + 1),
    attributes: element.attributes,
    children: element.children.map((child) => resolve(child, scope)),
    text: element.text,
  }
}

export const resolveNamespaces = (root: XmlElement): UblNode => resolve(root, new Map())

const childrenAt = (node: UblNode, segment: string): ReadonlyArray<UblNode> => {
  const colon = segment.indexOf(":")
  const namespace = PATH_PREFIXES[segment.slice(0, colon)]
  const local = segment.slice(colon + 1)
  return node.children.filter((child) => child.namespace === namespace && child.local === local)
}

/** Every element at the path, e.g. `cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID`. */
export const all = (node: UblNode, path: string): ReadonlyArray<UblNode> =>
  path.split("/").reduce<ReadonlyArray<UblNode>>((found, segment) => found.flatMap((parent) => childrenAt(parent, segment)), [node])

/** The element at the path, or nothing; a second one is refused, never chosen between. */
export const one = (node: UblNode, path: string): UblNode | undefined => {
  const found = all(node, path)
  if (found.length > 1) refuseField("duplicate", path)
  return found[0]
}

export const required = (node: UblNode, path: string): UblNode => one(node, path) ?? refuseField("missing", path)
