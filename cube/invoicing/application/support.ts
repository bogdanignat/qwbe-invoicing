import { Effect } from "effect"

import { ResourceNotFound, ValidationFailure, type InvoicingFailure } from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, TransactionalStore } from "../contracts/host.ts"
import type { BuyerSnapshot, DocumentSource, PartySnapshot } from "../domain/invoice.ts"
import type { DocumentCursor, DraftCursor, InvoicingTransaction, NameCursor, PageQuery } from "./ports.ts"

export type { DocumentCursor, DraftCursor, NameCursor, PageQuery } from "./ports.ts"

export type Authorize = (permission: string) => Effect.Effect<RequestContext, InvoicingFailure>

export interface OperationDependencies {
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly store: TransactionalStore<InvoicingTransaction>
}

export const checked = <Value>(operation: () => Value): Effect.Effect<Value, ValidationFailure> => Effect.try({
  try: operation,
  catch: (error) => error instanceof ValidationFailure
    ? error
    : new ValidationFailure({ issues: ["invalid invoicing input"] }),
})

export const missing = (resource: string, id: string) => new ResourceNotFound({ resource, id })

export const copyParty = (party: PartySnapshot): PartySnapshot => ({
  name: party.name,
  fiscalIdentifier: party.fiscalIdentifier.trim().toUpperCase(),
  address: { ...party.address },
})

export const copyBuyer = (buyer: BuyerSnapshot): BuyerSnapshot => ({
  ...copyParty(buyer),
  partyType: buyer.partyType,
})

// Keyset pagination. The application decodes the opaque cursor into a typed key, the store
// filters with it, and the application encodes the key of the last returned item.
export interface PageRequest {
  readonly limit?: number
  readonly cursor?: string
}
export interface Page<Item> {
  readonly items: ReadonlyArray<Item>
  readonly nextCursor: string | null
}

export const defaultPageSize = 100
export const maximumPageSize = 200

const invalidCursor = () => new ValidationFailure({ issues: ["cursor is invalid"] })

const decodeCursor = (cursor: string): Readonly<Record<string, unknown>> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
  } catch {
    throw invalidCursor()
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw invalidCursor()
  return parsed as Readonly<Record<string, unknown>>
}
const encodeCursor = (key: Readonly<Record<string, string | number>>): string =>
  Buffer.from(JSON.stringify(key), "utf8").toString("base64url")

const cursorText = (value: unknown): string => {
  if (typeof value !== "string") throw invalidCursor()
  return value
}
const cursorInteger = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) throw invalidCursor()
  return value
}

const pageLimit = (request: PageRequest | undefined): number => {
  const limit = request?.limit ?? defaultPageSize
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageSize) {
    throw new ValidationFailure({ issues: [`limit must be an integer between 1 and ${String(maximumPageSize)}`] })
  }
  return limit
}

const pageQuery = <Key>(request: PageRequest | undefined, parse: (raw: Readonly<Record<string, unknown>>) => Key): PageQuery<Key> => {
  const limit = pageLimit(request)
  return request?.cursor === undefined ? { limit } : { limit, after: parse(decodeCursor(request.cursor)) }
}

export const documentPageQuery = (request: PageRequest | undefined): PageQuery<DocumentCursor> => pageQuery(request, (raw) => ({
  issueDate: cursorText(raw.issueDate), number: cursorInteger(raw.number), id: cursorText(raw.id),
}))
export const draftPageQuery = (request: PageRequest | undefined): PageQuery<DraftCursor> => pageQuery(request, (raw) => ({
  issueDate: cursorText(raw.issueDate), id: cursorText(raw.id),
}))
export const namePageQuery = (request: PageRequest | undefined): PageQuery<NameCursor> => pageQuery(request, (raw) => ({
  name: cursorText(raw.name), id: cursorText(raw.id),
}))

// The store returns up to limit + 1 rows so the presence of a next page is known without a count.
export const pageOf = <Item>(
  rows: ReadonlyArray<Item>, query: PageQuery<unknown>, keyOf: (item: Item) => Readonly<Record<string, string | number>>,
): Page<Item> => {
  const items = rows.slice(0, query.limit)
  const last = items.at(-1)
  return { items: structuredClone(items), nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(keyOf(last)) : null }
}

export const copySource = (source: DocumentSource): DocumentSource => ({
  app: source.app,
  kind: source.kind,
  id: source.id,
})
