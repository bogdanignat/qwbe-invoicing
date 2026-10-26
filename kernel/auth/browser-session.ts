import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"

import type { Pool } from "pg"

import type { RuntimeConfig } from "../config.ts"
import { absoluteLifetimeMs, extendedExpiry, initialExpiry } from "./browser-session-lifetime.ts"
import { createSessionStore, type SessionRecord } from "./browser-session-store.ts"
import {
  cookieAttributes,
  cookieName,
  cookieValue,
  sameOrigin,
  sameValue,
  secureOrigin,
  sessionIdPattern,
  sha256,
} from "./browser-session-helpers.ts"

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"])
const safeMethod = (method: string): boolean => safeMethods.has(method.toUpperCase())
// Set once, at login: the cookie outlives a browser restart and ends with the
// absolute limit, while the row decides the sliding expiry in between.
const cookieMaxAgeSeconds = absoluteLifetimeMs / 1_000

interface AuthenticatedSession {
  readonly kind: "authenticated"
  readonly csrfToken: string
}

interface LoginSession extends AuthenticatedSession {
  readonly setCookie: string
}

interface StoredSession {
  readonly sessionHash: string
  readonly record: SessionRecord
}

interface AuthorizedRequest {
  readonly kind: "authorized"
  readonly authorization: string
}

interface UnauthorizedRequest {
  readonly kind: "unauthorized"
}

interface ForbiddenRequest {
  readonly kind: "forbidden"
}

type SessionState = AuthenticatedSession | UnauthorizedRequest
type SessionAuthorization = AuthorizedRequest | UnauthorizedRequest | ForbiddenRequest
type SessionLogin = LoginSession | UnauthorizedRequest | ForbiddenRequest

interface BrowserRequest {
  readonly cookie?: string | undefined
  readonly method: string
  readonly csrfToken?: string | undefined
  readonly origin?: string | undefined
  readonly host?: string | undefined
}

interface LoginRequest {
  readonly token: string
  readonly origin?: string | undefined
  readonly host?: string | undefined
}

const configuredToken = (config: RuntimeConfig): string | undefined => config.authTokenFile === undefined
  ? undefined
  : readFileSync(config.authTokenFile, "utf8").trim()

/**
 * Every lookup is a query now, so every entry point is asynchronous. There is no
 * synchronous variant: the callers (`http-request-listener`, the two
 * authentication layers, the sessions group) all await.
 */
export interface BrowserSession {
  readonly login: (request: LoginRequest) => Promise<SessionLogin>
  /** Only a safe method extends the session here: a write is extended by `authorize`, after CSRF. */
  readonly resume: (cookie: string | undefined, method: string) => Promise<SessionState>
  readonly authorize: (request: BrowserRequest) => Promise<SessionAuthorization>
  readonly revoke: (cookie: string | undefined) => Promise<boolean>
  readonly clearCookie: string
}

export const createBrowserSession = (
  config: RuntimeConfig,
  pool: Pool,
  now: () => number = Date.now,
): BrowserSession => {
  const token = configuredToken(config)
  if (token !== undefined && token.length < 32) throw new Error("AUTH_TOKEN_FILE must contain at least 32 characters")
  // An HTTPS public origin marks every session cookie Secure, the clearing one
  // included, whatever NODE_ENV says.
  const secure = config.nodeEnvironment === "production" || secureOrigin(config.publicOrigin)
  const credentialHash = token === undefined ? undefined : sha256(token)
  const store = createSessionStore(pool)
  const decode = async (cookie: string | undefined, at: number): Promise<StoredSession | undefined> => {
    const id = cookieValue(cookie)
    if (id === undefined || !sessionIdPattern.test(id)) return undefined
    if (credentialHash === undefined) return undefined
    const sessionHash = sha256(id)
    const record = await store.find(sessionHash)
    if (record === undefined || record.credentialHash !== credentialHash) return undefined
    if (record.expiresAt <= at) return undefined
    return { sessionHash, record }
  }
  // Sliding expiry: called only once a request has passed every check above
  // (and CSRF, for a write), so a refused request never keeps a session alive.
  const keepAlive = async ({ sessionHash, record }: StoredSession, at: number): Promise<void> => {
    const expiresAt = extendedExpiry(record, at)
    if (expiresAt !== undefined) await store.extend(sessionHash, expiresAt, at)
  }

  return {
    login: async (request) => {
      if (!sameOrigin(request.origin, request.host)) return { kind: "forbidden" }
      if (token === undefined || credentialHash === undefined || !sameValue(request.token.trim(), token)) return { kind: "unauthorized" }
      const id = randomBytes(32).toString("base64url")
      const csrfToken = randomBytes(32).toString("base64url")
      const createdAt = now()
      await store.create({ sessionHash: sha256(id), credentialHash, csrfToken, createdAt, expiresAt: initialExpiry(createdAt) })
      return {
        kind: "authenticated",
        csrfToken,
        setCookie: `${cookieName}=${id}; ${cookieAttributes(secure || secureOrigin(request.origin))}; Max-Age=${String(cookieMaxAgeSeconds)}`,
      }
    },
    resume: async (cookie, method) => {
      const at = now()
      const session = await decode(cookie, at)
      if (session === undefined) return { kind: "unauthorized" }
      if (safeMethod(method)) await keepAlive(session, at)
      return { kind: "authenticated", csrfToken: session.record.csrfToken }
    },
    authorize: async (request) => {
      const at = now()
      const session = await decode(request.cookie, at)
      if (session === undefined || token === undefined) return { kind: "unauthorized" }
      if (!safeMethod(request.method)
        && (!sameOrigin(request.origin, request.host)
          || request.csrfToken === undefined
          || !sameValue(request.csrfToken, session.record.csrfToken))) return { kind: "forbidden" }
      await keepAlive(session, at)
      return { kind: "authorized", authorization: `Bearer ${token}` }
    },
    revoke: async (cookie) => {
      const id = cookieValue(cookie)
      if (id === undefined || !sessionIdPattern.test(id)) return false
      return await store.remove(sha256(id))
    },
    clearCookie: `${cookieName}=; ${cookieAttributes(secure)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`,
  }
}
