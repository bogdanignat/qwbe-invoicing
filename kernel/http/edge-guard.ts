import type { IncomingMessage } from "node:http"

import { sessionCookieValues } from "../auth/browser-session-helpers.ts"

/**
 * The public edge, decided once per request before anything else runs: before
 * the branch on the path, before readiness, before the body is read and before
 * an authentication mechanism is chosen. What the BFF used to enforce in front
 * of the kernel, the kernel now enforces itself.
 */
export interface EdgePolicy {
  /** The canonical public origin (`PUBLIC_ORIGIN`). Host and Origin are pinned to it. */
  readonly origin: URL
  /** `QWBE_BEARER_API=on`. Off, any `Authorization` header is refused. */
  readonly bearerApi: boolean
}

export interface EdgeRefusal {
  readonly status: 400 | 403
  readonly error: string
}

/**
 * Headers that identify the caller. Node keeps the FIRST `Host` and
 * `Authorization` and drops the rest, so a duplicate would be judged on a value
 * the client may not mean; the raw header list is read instead.
 */
const singletonHeaders = new Set(["host", "origin", "authorization", "cookie", "x-forwarded-host", "x-forwarded-proto", "x-csrf-token"])
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"])

const duplicateHeader = (rawHeaders: ReadonlyArray<string>): boolean => {
  const seen = new Set<string>()
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index]?.toLowerCase() ?? ""
    if (!singletonHeaders.has(name)) continue
    if (seen.has(name)) return true
    seen.add(name)
  }
  return false
}

const text = (value: string | ReadonlyArray<string> | undefined): string | undefined =>
  typeof value === "string" ? value : undefined

/** A forwarded value is optional; present, it is one value (no list) and it matches. */
const forwardedMatches = (value: string | undefined, expected: string): boolean =>
  value === undefined || (!value.includes(",") && value.trim() === expected)

/** The Docker healthcheck calls `http://127.0.0.1:3000/health/ready`: no public Host. */
export const healthPath = (path: string): boolean => path === "/healthz" || path.startsWith("/health/")

const refuse = (status: 400 | 403, error: string): EdgeRefusal => ({ status, error })

export const edgeRefusal = (request: IncomingMessage, path: string, policy: EdgePolicy): EdgeRefusal | undefined => {
  if (duplicateHeader(request.rawHeaders)) return refuse(400, "duplicate_header")
  const { headers } = request
  if (!healthPath(path)) {
    if (headers.host !== policy.origin.host) return refuse(400, "invalid_host")
    if (!forwardedMatches(text(headers["x-forwarded-host"]), policy.origin.host)
      || !forwardedMatches(text(headers["x-forwarded-proto"]), policy.origin.protocol.slice(0, -1))) {
      return refuse(400, "invalid_forwarded_headers")
    }
  }
  const sessionCookies = sessionCookieValues(headers.cookie)
  if (headers.authorization !== undefined) {
    if (!policy.bearerApi) return refuse(400, "authorization_not_allowed")
    if (sessionCookies.length > 0) return refuse(400, "mixed_credentials")
  }
  if (sessionCookies.length > 1 || sessionCookies.includes("")) return refuse(400, "invalid_session_cookie")
  // Every unsafe method, on every path, with or without a credential: a Bearer
  // caller sends `Origin: <PUBLIC_ORIGIN>` like the browser does.
  if (!safeMethods.has(request.method ?? "") && headers.origin !== policy.origin.origin) return refuse(403, "origin_not_allowed")
  return undefined
}
