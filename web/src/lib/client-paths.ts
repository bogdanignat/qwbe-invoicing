import type { PageRequest } from "./models.ts"

export const ignored = (): undefined => undefined
export const encoded = (value: string): string => encodeURIComponent(value)

export const paged = (path: string, page: PageRequest | undefined): string => {
  const params = new URLSearchParams()
  if (page?.limit !== undefined) params.set("limit", String(page.limit))
  if (page?.cursor !== undefined) params.set("cursor", page.cursor)
  const query = params.toString()
  return query === "" ? path : `${path}?${query}`
}
