import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { Effect, Either } from "effect"

import { apiDocsResponse } from "./api-docs.ts"
import { handleApiRequest } from "./api.ts"
import { createRequestAuthenticator, hasBearerCredential } from "./auth.ts"
import { createBrowserSession } from "./browser-session.ts"
import type { RuntimeConfig } from "./config.ts"
import { createLoginThrottle, loginPeerKey, type SecurityLogger } from "./login-throttle.ts"
import { databaseReady } from "./migrations.ts"
import { cachedReadiness, readinessIntervalMs } from "./readiness.ts"
import { staticUiResponse } from "./static-ui.ts"

interface HttpResponse {
  readonly status: number
  readonly body: Readonly<Record<string, string>>
}

const maximumBodyBytes = 1_000_000

export const route = (method: string | undefined, url: string | undefined, ready: boolean): HttpResponse => {
  if (method !== "GET") return { status: 405, body: { status: "method_not_allowed" } }
  if (url === "/health/live") return { status: 200, body: { status: "live" } }
  if (url === "/health/ready") {
    return ready
      ? { status: 200, body: { status: "ready" } }
      : { status: 503, body: { status: "not_ready" } }
  }
  if (url === "/") return { status: 200, body: { application: "QWBE Invoicing", status: "invoice_core" } }
  return { status: 404, body: { status: "not_found" } }
}

const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
) => {
  if (body instanceof Uint8Array) {
    response.writeHead(status, { "x-content-type-options": "nosniff", ...headers })
    response.end(body)
    return
  }
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...headers,
  })
  response.end(`${JSON.stringify(body)}\n`)
}

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  if (request.method === "GET") return undefined
  const chunks: Array<Buffer> = []
  let size = 0
  for await (const chunk of request) {
    const value: unknown = chunk
    if (!(typeof value === "string" || value instanceof Uint8Array)) throw new Error("invalid_request_body")
    const bytes = Buffer.from(value)
    size += bytes.length
    if (size > maximumBodyBytes) throw new Error("request_body_too_large")
    chunks.push(bytes)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

const header = (value: string | ReadonlyArray<string> | undefined): string | undefined =>
  typeof value === "string" ? value : undefined

const loginToken = (body: unknown): string | undefined => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined
  const token = (body as Readonly<Record<string, unknown>>).token
  return typeof token === "string" && token.trim().length > 0 ? token : undefined
}

interface ServerDependencies {
  readonly now?: () => number
  readonly monotonicNow?: () => number
  readonly securityLogger?: SecurityLogger
  readonly peerKey?: (request: IncomingMessage) => string | undefined
}

export const startServer = (
  config: RuntimeConfig,
  isReady: () => boolean = cachedReadiness(() => databaseReady(config.dataDirectory), readinessIntervalMs),
  renderApiDocs: () => Promise<Awaited<ReturnType<typeof apiDocsResponse>>> = apiDocsResponse,
  dependencies: ServerDependencies = {},
): Server => {
  const authenticate = createRequestAuthenticator(config)
  const now = dependencies.now ?? Date.now
  const browserSession = createBrowserSession(config, now)
  const throttle = createLoginThrottle({
    now,
    ...(dependencies.monotonicNow === undefined ? {} : { monotonicNow: dependencies.monotonicNow }),
    ...(dependencies.securityLogger === undefined ? {} : { logger: dependencies.securityLogger }),
  })
  const server = createServer((request, response) => {
    const peer = loginPeerKey(dependencies.peerKey === undefined ? request.socket.remoteAddress : dependencies.peerKey(request))
    const rejectCooldown = (): boolean => {
      const retryAfter = throttle.check(peer)
      if (retryAfter === 0) return false
      send(response, 429, { error: "too_many_attempts" }, { "retry-after": String(retryAfter) })
      return true
    }
    void (async () => {
      const path = request.url === undefined ? undefined : new URL(request.url, "http://localhost").pathname
      if (path === "/api" && request.method === "GET") {
        if (!isReady()) {
          send(response, 503, { error: "not_ready" })
          return
        }
        const session = browserSession.resume(header(request.headers.cookie))
        if (session.kind === "unauthorized") {
          send(response, 401, { error: "AuthenticationRequired" }, { "set-cookie": browserSession.clearCookie })
          return
        }
        try {
          const docs = await renderApiDocs()
          send(response, docs.status, docs.body, docs.headers)
        } catch {
          send(response, 500, { error: "internal_failure" })
        }
        return
      }
      if (path?.startsWith("/api/") === true) {
        if (!isReady()) {
          send(response, 503, { error: "not_ready" })
          return
        }
        try {
          const cookie = header(request.headers.cookie)
          const origin = header(request.headers.origin)
          const host = header(request.headers.host)
          const csrfToken = header(request.headers["x-csrf-token"])
          if (path === "/api/session") {
            if (request.method === "POST") {
              if (rejectCooldown()) return
              const token = loginToken(await readBody(request))
              // A request may have been waiting on its body while other attempts
              // activated a cooldown. Recheck at the credential verification seam.
              if (rejectCooldown()) return
              if (token === undefined) {
                send(response, 400, { error: "invalid_credentials" })
                return
              }
              const login = browserSession.login({ token, origin, host })
              if (login.kind === "forbidden") {
                send(response, 403, { error: "origin_not_allowed" })
                return
              }
              if (login.kind === "unauthorized") {
                throttle.failed(peer)
                send(response, 401, { error: "invalid_credentials" }, { "set-cookie": browserSession.clearCookie })
                return
              }
              throttle.succeeded(peer)
              send(response, 200, { authenticated: true, csrfToken: login.csrfToken }, { "set-cookie": login.setCookie })
              return
            }
            if (request.method === "GET") {
              const session = browserSession.resume(cookie)
              if (session.kind === "unauthorized") {
                send(response, 401, { error: "AuthenticationRequired" }, { "set-cookie": browserSession.clearCookie })
                return
              }
              send(response, 200, { authenticated: true, csrfToken: session.csrfToken })
              return
            }
            if (request.method === "DELETE") {
              const authorization = browserSession.authorize({ cookie, method: "DELETE", csrfToken, origin, host })
              if (authorization.kind === "forbidden") {
                send(response, 403, { error: "csrf_validation_failed" })
                return
              }
              if (authorization.kind === "unauthorized") {
                send(response, 401, { error: "AuthenticationRequired" }, { "set-cookie": browserSession.clearCookie })
                return
              }
              browserSession.revoke(cookie)
              send(response, 200, { authenticated: false }, { "set-cookie": browserSession.clearCookie })
              return
            }
            send(response, 405, { error: "method_not_allowed" })
            return
          }
          let authorization = header(request.headers.authorization)
          const explicitCredential = hasBearerCredential(authorization)
          if (explicitCredential && rejectCooldown()) return
          if (authorization === undefined) {
            const sessionAuthorization = browserSession.authorize({
              cookie,
              method: request.method ?? "GET",
              csrfToken,
              origin,
              host,
            })
            if (sessionAuthorization.kind === "forbidden") {
              send(response, 403, { error: "csrf_validation_failed" })
              return
            }
            if (sessionAuthorization.kind === "authorized") authorization = sessionAuthorization.authorization
          }
          const idempotencyKey = header(request.headers["idempotency-key"])
          const body = await readBody(request)
          if (explicitCredential && rejectCooldown()) return
          let requestAuthenticate = authenticate
          if (explicitCredential) {
            // The standalone credential provider is synchronous and local. Keep
            // admission, credential validation and accounting in this same turn,
            // before awaiting business I/O; otherwise concurrent requests race.
            const authenticated = Effect.runSync(Effect.either(authenticate(authorization).current))
            if (Either.isLeft(authenticated)) {
              const invalid = authenticated.left._tag === "AuthenticationRequired"
              if (invalid) throttle.failed(peer)
              send(response, invalid ? 401 : 503, { error: authenticated.left._tag })
              return
            }
            throttle.succeeded(peer)
            const context = authenticated.right
            requestAuthenticate = () => ({ current: Effect.succeed(context) })
          }
          const result = await handleApiRequest({
            method: request.method ?? "GET",
            url: request.url ?? path,
            authorization,
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
            body,
          }, { authenticate: requestAuthenticate, dataDirectory: config.dataDirectory })
          const responseHeaders = result.status === 401 && authorization === undefined && cookie !== undefined
            ? { ...result.headers, "set-cookie": browserSession.clearCookie }
            : result.headers
          send(response, result.status, result.body, responseHeaders)
        } catch (error) {
          if (error instanceof Error && error.message === "request_body_too_large") {
            send(response, 413, { error: "request_body_too_large" })
          } else if (error instanceof SyntaxError) {
            send(response, 400, { error: "invalid_json" })
          } else {
            send(response, 500, { error: "internal_failure" })
          }
        }
        return
      }
      const ui = staticUiResponse(request.method, path)
      if (ui !== undefined) {
        send(response, ui.status, ui.body, ui.headers)
        return
      }
      const result = route(request.method, path, isReady())
      send(response, result.status, result.body)
    })()
  })
  server.listen(config.port, config.host, () => {
    console.log(`QWBE Invoicing listening on http://${config.host}:${String(config.port)}`)
  })
  return server
}
