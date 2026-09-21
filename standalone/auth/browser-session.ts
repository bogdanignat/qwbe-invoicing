import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import type { RuntimeConfig } from "../config.ts"
import { sessionsDatabasePath } from "../storage/migrations.ts"
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

export interface BrowserSession {
  readonly login: (request: LoginRequest) => SessionLogin
  readonly resume: (cookie: string | undefined) => SessionState
  readonly authorize: (request: BrowserRequest) => SessionAuthorization
  readonly revoke: (cookie: string | undefined) => boolean
  readonly clearCookie: string
}

export const createBrowserSession = (
  config: RuntimeConfig,
  now: () => number = Date.now,
): BrowserSession => {
  const token = configuredToken(config)
  if (token !== undefined && token.length < 32) throw new Error("AUTH_TOKEN_FILE must contain at least 32 characters")
  const secure = config.nodeEnvironment === "production"
  const credentialHash = token === undefined ? undefined : sha256(token)
  const databaseFile = sessionsDatabasePath(config.dataDirectory)
  const withDatabase = <Value>(run: (database: DatabaseSync) => Value): Value => {
    const database = new DatabaseSync(databaseFile)
    try {
      return run(database)
    } finally {
      database.close()
    }
  }
  const decode = (cookie: string | undefined): AuthenticatedSession | undefined => {
    const id = cookieValue(cookie)
    if (id === undefined || !sessionIdPattern.test(id)) return undefined
    if (credentialHash === undefined) return undefined
    const record = withDatabase((database) => database.prepare(
      "SELECT credential_hash, csrf_token, expires_at FROM browser_sessions WHERE session_hash = ?",
    ).get(sha256(id)))
    if (record === undefined || record.credential_hash !== credentialHash
      || typeof record.csrf_token !== "string" || typeof record.expires_at !== "number") return undefined
    if (!Number.isSafeInteger(record.expires_at) || record.expires_at <= now()) return undefined
    return { kind: "authenticated", csrfToken: record.csrf_token }
  }

  return {
    login: (request) => {
      if (!sameOrigin(request.origin, request.host)) return { kind: "forbidden" }
      if (token === undefined || credentialHash === undefined || !sameValue(request.token.trim(), token)) return { kind: "unauthorized" }
      const id = randomBytes(32).toString("base64url")
      const csrfToken = randomBytes(32).toString("base64url")
      const createdAt = now()
      const expiresAt = createdAt + sessionLifetimeSeconds * 1_000
      withDatabase((database) => {
        database.exec("BEGIN IMMEDIATE")
        try {
          database.prepare("DELETE FROM browser_sessions WHERE expires_at <= ?").run(createdAt)
          database.prepare(
            "INSERT INTO browser_sessions (session_hash, credential_hash, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
          ).run(sha256(id), credentialHash, csrfToken, createdAt, expiresAt)
          database.exec("COMMIT")
        } catch (error) {
          database.exec("ROLLBACK")
          throw error
        }
      })
      return {
        kind: "authenticated",
        csrfToken,
        setCookie: `${cookieName}=${id}; ${cookieAttributes(secure || secureOrigin(request.origin))}; Max-Age=${String(sessionLifetimeSeconds)}`,
      }
    },
    resume: (cookie) => decode(cookie) ?? { kind: "unauthorized" },
    authorize: (request) => {
      const session = decode(request.cookie)
      if (session === undefined || token === undefined) return { kind: "unauthorized" }
      if (!safeMethods.has(request.method.toUpperCase())
        && (!sameOrigin(request.origin, request.host)
          || request.csrfToken === undefined
          || !sameValue(request.csrfToken, session.csrfToken))) return { kind: "forbidden" }
      return { kind: "authorized", authorization: `Bearer ${token}` }
    },
    revoke: (cookie) => {
      const id = cookieValue(cookie)
      if (id === undefined || !sessionIdPattern.test(id)) return false
      return withDatabase((database) => database.prepare(
        "DELETE FROM browser_sessions WHERE session_hash = ?",
      ).run(sha256(id)).changes === 1)
    },
    clearCookie: `${cookieName}=; ${cookieAttributes(secure)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`,
  }
}
