/**
 * How the router reads and writes the query string: plain text pairs, the way
 * `URLSearchParams` does.
 *
 * The router's default would JSON-decode values on the way in and quote them on
 * the way out, so an address could change under the screen that owns it. Here a
 * value stays the text it was, and a key that repeats keeps its first value —
 * what `URLSearchParams.get` answers, and so what `dashboard-query.ts` reads.
 */
export const parseSearch = (search: string): Record<string, string> => {
  const pairs = new Map<string, string>()
  for (const [key, value] of new URLSearchParams(search)) {
    if (!pairs.has(key)) pairs.set(key, value)
  }
  return Object.fromEntries(pairs)
}

/** `?` and the pairs in their order, or nothing when there are none; values that are not text are left out. */
export const stringifySearch = (search: Record<string, unknown>): string => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") params.append(key, value)
  }
  const text = params.toString()
  return text === "" ? "" : `?${text}`
}
