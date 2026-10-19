/**
 * The request-target exactly as the client sent it, checked before anything
 * parses it. `new URL()` normalises: `/api/../health/live` and
 * `/api/%2e%2e/health/live` both become `/health/live`, so a path classified
 * after parsing is not the path that was asked for. The kernel classifies the
 * raw path instead, and refuses the shapes that normalisation would rewrite.
 *
 * A segment is refused when it is `.` or `..`, holds a backslash or a control
 * character, or becomes one of those after up to four decodings. Encoded IDs
 * stay intact (`customer%2F1`, `v%25`): only what they decode to is judged,
 * never the fact that they are encoded.
 *
 * The API router (find-my-way-ts) matches a different string than the one sent:
 * it cuts the path at `;`, decodes every escape `decodeURI` decodes, ignores a
 * trailing slash and compares case-insensitively. The first two would let
 * `/api/%73ession` or `/api/session;x` reach the login handler unrecognised, so
 * they are refused here; the last two are folded by `routerPath`.
 */
export interface RequestTarget {
  /** The raw path, never decoded and never normalised. */
  readonly path: string
}

const unsafeText = (value: string): boolean => {
  if (value.includes("\\") || value.split("/").some((part) => part === "." || part === "..")) return true
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) return true
  }
  return false
}

/** An escape of an RFC 3986 unreserved character is only ever an alias of that character. */
const aliasEscape = (path: string): boolean =>
  [...path.matchAll(/%([0-9a-f]{2})/giu)].some(([, hex]) => /^[\w.~-]$/u.test(String.fromCharCode(Number.parseInt(hex ?? "", 16))))

const maximumDecodings = 4

const unsafeSegment = (segment: string): boolean => {
  let value = segment
  for (let pass = 0; pass <= maximumDecodings; pass += 1) {
    if (unsafeText(value)) return true
    let decoded: string
    try {
      decoded = decodeURIComponent(value)
    } catch {
      // Malformed as sent is refused; a literal `%` that one decoding produced
      // (`v%25` -> `v%`) is data, not another layer of encoding.
      return pass === 0
    }
    if (decoded === value) return false
    value = decoded
  }
  return true
}

/**
 * Origin-form only: `*`, absolute-form and `//authority` targets are refused,
 * and so is an empty interior segment, because `//x` is protocol-relative to a
 * URL parser and would silently drop the first segment.
 */
export const requestTarget = (raw: string | undefined): RequestTarget | undefined => {
  if (raw === undefined || !raw.startsWith("/") || raw.includes("#")) return undefined
  const queryAt = raw.indexOf("?")
  const path = queryAt < 0 ? raw : raw.slice(0, queryAt)
  if (path.includes("//") || path.includes(";") || aliasEscape(path)) return undefined
  if (path.slice(1).split("/").some(unsafeSegment)) return undefined
  return { path }
}

/**
 * The path as the API router looks up its static routes, with the options Effect
 * leaves at find-my-way-ts's defaults (`caseSensitive: false`,
 * `ignoreTrailingSlash: true`; duplicate slashes, `;` and alias escapes are
 * already refused). Every decision keyed on an API route uses this form, so
 * `/api/Session/` is the login route here exactly as it is there.
 */
export const routerPath = (path: string): string =>
  (path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path).toLowerCase()
