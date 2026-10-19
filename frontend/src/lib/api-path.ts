const API_PREFIX = "/api/"
/** A placeholder origin to resolve against: only a path that stays on it is same-origin. */
const PROBE_ORIGIN = "http://o"

const invalid = (): Error => new Error("Calea API este invalidă.")

/**
 * The browser talks to the API on its own origin, under `/api/`, and this is
 * the one check every request path passes. It answers the path unchanged — an
 * encoded id and a repeated query parameter leave exactly as they were built —
 * or refuses it.
 *
 * The path is resolved the way `fetch` will resolve it, and refused unless that
 * changes nothing: no other origin (an absolute or protocol-relative URL), no
 * dot segment in any spelling (`..`, `%2e%2e`, `.%2e`), no backslash, nothing
 * the URL parser would rewrite. What is left must sit under `/api/`.
 */
export const browserApiPath = (path: string): string => {
  let url: URL
  try {
    url = new URL(path, PROBE_ORIGIN)
  } catch {
    throw invalid()
  }
  const pathname = path.split(/[?#]/u, 1)[0] ?? ""
  if (url.origin !== PROBE_ORIGIN || url.pathname !== pathname || !pathname.startsWith(API_PREFIX)) {
    throw invalid()
  }
  return path
}
