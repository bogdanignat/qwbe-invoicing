const sessionValue = /^[A-Za-z0-9_-]{43}$/u
const allowedAttributes = new Set(["path", "httponly", "samesite", "secure", "max-age", "expires"])

interface ParsedCookie {
  readonly cookie: string
  readonly attributes: ReadonlyMap<string, string>
}

const parse = (value: string): ParsedCookie | undefined => {
  const parts = value.split(";").map((part) => part.trim())
  const pair = parts.shift() ?? ""
  if (!pair.startsWith("qwbe_session=")) return undefined
  const attributes = new Map<string, string>()
  for (const part of parts) {
    const separator = part.indexOf("=")
    const name = (separator < 0 ? part : part.slice(0, separator)).toLowerCase()
    if (!allowedAttributes.has(name) || attributes.has(name)) return undefined
    attributes.set(name, separator < 0 ? "" : part.slice(separator + 1))
  }
  return { cookie: pair.slice("qwbe_session=".length), attributes }
}

const commonAttributesValid = (attributes: ReadonlyMap<string, string>): boolean =>
  attributes.get("path") === "/api" && attributes.get("httponly") === ""
  && attributes.get("samesite")?.toLowerCase() === "strict"
  && (attributes.get("secure") === undefined || attributes.get("secure") === "")

const clearCookieValid = ({ attributes, cookie }: ParsedCookie): boolean => cookie.length === 0
  && attributes.get("max-age") === "0"
  && attributes.get("expires") === "Thu, 01 Jan 1970 00:00:00 GMT"

const issuedCookieValid = ({ attributes, cookie }: ParsedCookie): boolean => sessionValue.test(cookie)
  && /^\d+$/u.test(attributes.get("max-age") ?? "")
  && Number(attributes.get("max-age")) > 0
  && !attributes.has("expires")

export const normalizedSessionSetCookie = (value: string, requireSecure: boolean): string | undefined => {
  const parsed = parse(value)
  if (parsed === undefined || !commonAttributesValid(parsed.attributes)) return undefined
  const clear = clearCookieValid(parsed)
  if (!clear && !issuedCookieValid(parsed)) return undefined
  if (parsed.attributes.has("secure")) return value
  if (!requireSecure) return value
  return clear ? `${value}; Secure` : undefined
}

export const validSessionSetCookie = (value: string, requireSecure = true): boolean =>
  normalizedSessionSetCookie(value, requireSecure) !== undefined

/**
 * Whether a Set-Cookie claims the session name, regardless of whether it is valid.
 *
 * Validity and ownership are different questions: `normalizedSessionSetCookie`
 * answers `undefined` both for a foreign cookie, which is simply not ours to
 * forward, and for a malformed session cookie, which is a broken upstream we
 * must not paper over. Only the name decides which of the two it is.
 *
 * Space between the name and `=` makes the header malformed, not foreign. RFC
 * 6265 admits none there, so `parse` keeps refusing it and the response still
 * fails — but it must fail as a broken session cookie, answering `502`, rather
 * than be mistaken for someone else's cookie and dropped from a `200` that then
 * claims a session the browser never received. Ownership is read with the
 * padding allowed; acceptance is not widened by a single character. The name is
 * compared case-sensitively, so `QWBE_SESSION=` stays a foreign cookie.
 */
const sessionName = /^qwbe_session[ \t]*=/u

export const isSessionSetCookie = (value: string): boolean =>
  sessionName.test((value.split(";", 1)[0] ?? "").trim())
