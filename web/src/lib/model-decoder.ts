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
export const optionalText = (input: unknown, field: string): string | undefined =>
  input === undefined || input === null ? undefined : text(input, field)
export const optionalInteger = (input: unknown, field: string): number | undefined =>
  input === undefined || input === null ? undefined : integer(input, field)
export const nullableText = (input: unknown, field: string): string | null => input === null ? null : text(input, field)
export const array = <Value>(input: unknown, decode: Decoder<Value>, field: string): ReadonlyArray<Value> => {
  if (!Array.isArray(input)) throw new Error(`invalid ${field}`)
  return input.map(decode)
}
