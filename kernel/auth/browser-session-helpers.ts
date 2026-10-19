import { createHash, timingSafeEqual } from "node:crypto"

export const cookieName = "qwbe_session"
export const sessionIdPattern = /^[A-Za-z0-9_-]{43}$/

export const sameValue = (actual: string, expected: string): boolean => {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

export const sameOrigin = (origin: string | undefined, host: string | undefined): boolean => {
  if (origin === undefined || host === undefined) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host
  } catch {
    return false
  }
}

export const secureOrigin = (origin: string | undefined): boolean => {
  try {
    return origin !== undefined && new URL(origin).protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Every `qwbe_session` value in a Cookie header, empty ones included. Split on
 * `,` as well as `;`, so a folded header cannot hide a second session cookie.
 */
export const sessionCookieValues = (header: string | undefined): ReadonlyArray<string> => {
  if (header === undefined) return []
  const values: Array<string> = []
  for (const item of header.split(/[;,]/u)) {
    const separator = item.indexOf("=")
    const name = (separator < 0 ? item : item.slice(0, separator)).trim()
    if (name === cookieName) values.push(separator < 0 ? "" : item.slice(separator + 1).trim())
  }
  return values
}

/** The session id, only when exactly one non-empty session cookie was sent. */
export const cookieValue = (header: string | undefined): string | undefined => {
  const values = sessionCookieValues(header)
  return values.length === 1 && values[0] !== "" ? values[0] : undefined
}

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")

export const cookieAttributes = (secure: boolean): string =>
  `Path=/api; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`
