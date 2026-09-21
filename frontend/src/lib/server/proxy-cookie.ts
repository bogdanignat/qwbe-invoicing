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
