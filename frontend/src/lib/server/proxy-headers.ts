import type { IncomingHttpHeaders } from "node:http"

import type { ProxyConfig } from "./config.ts"
import { isSessionSetCookie, normalizedSessionSetCookie } from "./proxy-cookie.ts"

export { validSessionSetCookie } from "./proxy-cookie.ts"

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"])
const forwardedIdentity = (request: Request, name: string): string | undefined => {
  const value = request.headers.get(name)
  if (value === null || value.includes(",")) return value === null ? undefined : ""
  return value.trim()
}

export type RequestHeaderResult =
  | { readonly ok: true; readonly headers: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly status: 400 | 403; readonly error: string }

const sessionCookie = (header: string | null): { readonly valid: boolean; readonly value?: string } => {
  if (header === null) return { valid: true }
  const matches: Array<string> = []
  for (const item of header.split(/[;,]/u)) {
    const separator = item.indexOf("=")
    const name = (separator < 0 ? item : item.slice(0, separator)).trim()
    if (name !== "qwbe_session") continue
    matches.push(separator < 0 ? "" : item.slice(separator + 1).trim())
  }
  if (matches.length !== 1) return matches.length === 0 ? { valid: true } : { valid: false }
  const value = matches[0] as string
  return value.length === 0 ? { valid: false } : { valid: true, value }
}

export const proxyRequestHeaders = (request: Request, config: ProxyConfig): RequestHeaderResult => {
  const expectedHost = config.frontendOrigin.host
  const host = request.headers.get("host")
  if (host !== expectedHost) return { ok: false, status: 400, error: "invalid_host" }
  const forwardedHost = forwardedIdentity(request, "x-forwarded-host")
  const forwardedProto = forwardedIdentity(request, "x-forwarded-proto")
  if ((forwardedHost !== undefined && forwardedHost !== expectedHost)
    || (forwardedProto !== undefined && forwardedProto !== config.frontendOrigin.protocol.slice(0, -1))) {
    return { ok: false, status: 400, error: "invalid_forwarded_headers" }
  }
  if (request.headers.has("authorization")) return { ok: false, status: 400, error: "authorization_not_allowed" }
  if (unsafeMethods.has(request.method.toUpperCase()) && request.headers.get("origin") !== config.frontendOrigin.origin) {
    return { ok: false, status: 403, error: "origin_not_allowed" }
  }
  const cookie = sessionCookie(request.headers.get("cookie"))
  if (!cookie.valid) return { ok: false, status: 400, error: "invalid_session_cookie" }

  const headers: Record<string, string> = { host: expectedHost, origin: config.frontendOrigin.origin }
  for (const name of ["accept", "content-type", "x-csrf-token", "idempotency-key"] as const) {
    const value = request.headers.get(name)
    if (value !== null) headers[name] = value
  }
  if (cookie.value !== undefined) headers.cookie = `qwbe_session=${cookie.value}`
  return { ok: true, headers }
}

const responseNames = new Set(["content-type", "content-disposition", "etag", "retry-after", "allow"])

export type ResponseHeaderResult =
  | { readonly ok: true; readonly headers: Headers }
  | { readonly ok: false; readonly error: "invalid_upstream_cookie" }

/**
 * A session cookie the contract rejects is a failure, not a header to drop.
 *
 * Dropping it silently would answer 200 with a body the caller reads as success
 * while the session it was told it received never exists, so the browser keeps
 * the previous cookie or none at all. More than one session cookie in a single
 * response is the same failure by another route: the response describes two
 * sessions and nothing here may pick the one that counts. Foreign cookies stay
 * ignored — they were never part of this contract.
 */
export const proxyResponseHeaders = (
  headers: IncomingHttpHeaders,
  rawHeaders: ReadonlyArray<string>,
  requireSecureCookie: boolean,
): ResponseHeaderResult => {
  const result = new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" })
  for (const [name, value] of Object.entries(headers)) {
    if (!responseNames.has(name) || typeof value !== "string") continue
    result.set(name, value)
  }
  let sessionCookies = 0
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() !== "set-cookie") continue
    const value = rawHeaders[index + 1]
    if (value === undefined || !isSessionSetCookie(value)) continue
    sessionCookies += 1
    const normalized = normalizedSessionSetCookie(value, requireSecureCookie)
    if (sessionCookies > 1 || normalized === undefined) return { ok: false, error: "invalid_upstream_cookie" }
    result.append("set-cookie", normalized)
  }
  return { ok: true, headers: result }
}
