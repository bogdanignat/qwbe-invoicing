/**
 * The narrowing every API answer passes through before it is a model.
 *
 * Nothing that crosses the network is trusted as typed: a decoder takes
 * `unknown` and either returns the declared shape or throws, so a field the
 * backend stopped sending fails at the boundary instead of surfacing as
 * `undefined` three components deep.
 */
export type JsonObject = Readonly<Record<string, unknown>>
export type Decoder<Value> = (input: unknown) => Value

export const object = (input: unknown): JsonObject => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("expected object")
  return input as JsonObject
}

export const text = (input: unknown, field: string): string => {
  if (typeof input !== "string") throw new Error(`invalid ${field}`)
  return input
}

export const integer = (input: unknown, field: string): number => {
  if (typeof input !== "number" || !Number.isInteger(input)) throw new Error(`invalid ${field}`)
  return input
}

export const boolean = (input: unknown, field: string): boolean => {
  if (typeof input !== "boolean") throw new Error(`invalid ${field}`)
  return input
}

export const nullableText = (input: unknown, field: string): string | null =>
  input === null ? null : text(input, field)

export const optionalText = (input: unknown, field: string): string | undefined =>
  input === undefined || input === null ? undefined : text(input, field)

export const optionalInteger = (input: unknown, field: string): number | undefined =>
  input === undefined || input === null ? undefined : integer(input, field)

export const array = <Value>(input: unknown, decode: Decoder<Value>, field: string): ReadonlyArray<Value> => {
  if (!Array.isArray(input)) throw new Error(`invalid ${field}`)
  return input.map((item) => decode(item))
}

export interface Page<Item> {
  readonly items: ReadonlyArray<Item>
  readonly nextCursor: string | null
}

export interface PageRequest {
  readonly limit?: number
  readonly cursor?: string
}

export const decodePage = <Item>(decodeItem: Decoder<Item>): Decoder<Page<Item>> => (input) => {
  const value = object(input)
  return {
    items: array(value.items, decodeItem, "items"),
    nextCursor: nullableText(value.nextCursor, "nextCursor"),
  }
}
