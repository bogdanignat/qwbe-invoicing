import type { PageRequest } from "./model-decoder.ts"

/**
 * Identifiers arrive from the server and leave in a path segment, so they are
 * encoded on the way out rather than trusted to be path-safe.
 */
export const encoded = (value: string): string => encodeURIComponent(value)

export const paged = (path: string, page: PageRequest | undefined): string => {
  const params = new URLSearchParams()
  if (page?.limit !== undefined) params.set("limit", String(page.limit))
  if (page?.cursor !== undefined) params.set("cursor", page.cursor)
  const query = params.toString()
  return query === "" ? path : `${path}?${query}`
}
