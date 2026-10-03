import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"

import type { Pool } from "pg"

import type { RuntimeConfig } from "../config.ts"
import { createSessionStore } from "./browser-session-store.ts"
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

const sessionLifetimeSeconds = 60 * 60 * 24 * 30
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"])

interface AuthenticatedSession {
  readonly kind: "authenticated"
  readonly csrfToken: string
}

interface LoginSession extends AuthenticatedSession {
  readonly setCookie: string
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
  readonly resume: (cookie: string | undefined) => Promise<SessionState>
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
  const secure = config.nodeEnvironment === "production"
  const credentialHash = token === undefined ? undefined : sha256(token)
  const store = createSessionStore(pool)
  const decode = async (cookie: string | undefined): Promise<AuthenticatedSession | undefined> => {
    const id = cookieValue(cookie)
    if (id === undefined || !sessionIdPattern.test(id)) return undefined
    if (credentialHash === undefined) return undefined
    const record = await store.find(sha256(id))
    if (record === undefined || record.credentialHash !== credentialHash) return undefined
    if (record.expiresAt <= now()) return undefined
    return { kind: "authenticated", csrfToken: record.csrfToken }
  }

  return {
    login: async (request) => {
      if (!sameOrigin(request.origin, request.host)) return { kind: "forbidden" }
      if (token === undefined || credentialHash === undefined || !sameValue(request.token.trim(), token)) return { kind: "unauthorized" }
      const id = randomBytes(32).toString("base64url")
      const csrfToken = randomBytes(32).toString("base64url")
      const createdAt = now()
      const expiresAt = createdAt + sessionLifetimeSeconds * 1_000
      await store.create({ sessionHash: sha256(id), credentialHash, csrfToken, createdAt, expiresAt })
      return {
        kind: "authenticated",
        csrfToken,
        setCookie: `${cookieName}=${id}; ${cookieAttributes(secure || secureOrigin(request.origin))}; Max-Age=${String(sessionLifetimeSeconds)}`,
      }
    },
    resume: async (cookie) => await decode(cookie) ?? { kind: "unauthorized" },
    authorize: async (request) => {
      const session = await decode(request.cookie)
      if (session === undefined || token === undefined) return { kind: "unauthorized" }
      if (!safeMethods.has(request.method.toUpperCase())
        && (!sameOrigin(request.origin, request.host)
          || request.csrfToken === undefined
          || !sameValue(request.csrfToken, session.csrfToken))) return { kind: "forbidden" }
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
