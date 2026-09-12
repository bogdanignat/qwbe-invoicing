import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { Effect, Either } from "effect"

import { apiDocsResponse } from "./api-docs.ts"
import { createApiHandler } from "./api.ts"
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
  if (url === "/health/ready") return ready ? { status: 200, body: { status: "ready" } } : { status: 503, body: { status: "not_ready" } }
  if (url === "/") return { status: 200, body: { application: "QWBE Invoicing", status: "invoice_core" } }
  return { status: 404, body: { status: "not_found" } }
}

const send = (response: ServerResponse, status: number, body: unknown, headers: Readonly<Record<string, string>> = {}) => {
  if (body instanceof Uint8Array) {
    response.writeHead(status, { "x-content-type-options": "nosniff", ...headers })
    response.end(body)
    return
  }
  response.writeHead(status, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff", ...headers })
  response.end(`${JSON.stringify(body)}\n`)
}
const readRawBody = async (request: IncomingMessage): Promise<string> => {
  if (request.method === "GET" || request.method === "HEAD") return ""
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
  return Buffer.concat(chunks).toString("utf8")
}
const webRequest = (request: IncomingMessage, raw: string): Request => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value)
    else if (Array.isArray(value)) for (const item of value) headers.append(name, item)
  }
  const method = request.method ?? "GET"
  return new Request(`http://${request.headers.host ?? "localhost"}${request.url ?? "/"}`, {
    method, headers, ...(method === "GET" || method === "HEAD" ? {} : { body: raw.length === 0 ? "{}" : raw }),
  })
}
const header = (value: string | ReadonlyArray<string> | undefined): string | undefined => typeof value === "string" ? value : undefined

export interface ServerDependencies {
  readonly now?: () => number
  readonly monotonicNow?: () => number
  readonly securityLogger?: SecurityLogger
  readonly peerKey?: (request: IncomingMessage) => string | undefined
  readonly apiHandlerFactory?: typeof createApiHandler
}
export interface RunningServer {
  readonly server: Server
  readonly close: () => Promise<void>
}

const listen = (server: Server, config: RuntimeConfig): Promise<void> => new Promise((resolve, reject) => {
  const onError = (error: Error) => { server.off("listening", onListening); reject(error) }
  const onListening = () => { server.off("error", onError); resolve() }
  server.once("error", onError)
  server.once("listening", onListening)
  server.listen(config.port, config.host)
})

export const startServer = async (
  config: RuntimeConfig,
  isReady: () => boolean = cachedReadiness(() => databaseReady(config.dataDirectory), readinessIntervalMs),
  renderApiDocs: () => Promise<Awaited<ReturnType<typeof apiDocsResponse>>> = apiDocsResponse,
  dependencies: ServerDependencies = {},
): Promise<RunningServer> => {
  const authenticate = createRequestAuthenticator(config)
  const now = dependencies.now ?? Date.now
  const browserSession = createBrowserSession(config, now)
  const throttle = createLoginThrottle({ now,
    ...(dependencies.monotonicNow === undefined ? {} : { monotonicNow: dependencies.monotonicNow }),
    ...(dependencies.securityLogger === undefined ? {} : { logger: dependencies.securityLogger }) })
  const apiFactory = dependencies.apiHandlerFactory ?? createApiHandler
  const api = apiFactory({ authenticate, dataDirectory: config.dataDirectory, browserSession })
  let disposePromise: Promise<void> | undefined
  const dispose = () => disposePromise ??= api.dispose()
  let closePromise: Promise<void> | undefined
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
        if (!isReady()) { send(response, 503, { error: "not_ready" }); return }
        const session = browserSession.resume(header(request.headers.cookie))
        if (session.kind === "unauthorized") {
          send(response, 401, { error: "AuthenticationRequired" }, { "set-cookie": browserSession.clearCookie }); return
        }
        try { const docs = await renderApiDocs(); send(response, docs.status, docs.body, docs.headers) }
        catch { send(response, 500, { error: "internal_failure" }) }
        return
      }
      if (path?.startsWith("/api/") === true) {
        if (!isReady()) { send(response, 503, { error: "not_ready" }); return }
        try {
          const login = path === "/api/session" && request.method === "POST"
          if (login && rejectCooldown()) return
          const authorization = header(request.headers.authorization)
          const explicitCredential = hasBearerCredential(authorization)
          if (explicitCredential && rejectCooldown()) return
          const raw = await readRawBody(request)
          if ((login || explicitCredential) && rejectCooldown()) return
          if (explicitCredential) {
            const authenticated = Effect.runSync(Effect.either(authenticate(authorization).current))
            if (Either.isLeft(authenticated)) {
              const invalid = authenticated.left._tag === "AuthenticationRequired"
              if (invalid) throttle.failed(peer)
              send(response, invalid ? 401 : 503, { error: authenticated.left._tag })
              return
            }
            throttle.succeeded(peer)
          }
          const result = await api.handle(webRequest(request, raw))
          if (login && result.status === 401) throttle.failed(peer)
          else if (login && result.status === 200) throttle.succeeded(peer)
          const body = Buffer.from(await result.arrayBuffer())
          const headers: Record<string, string | string[]> = {
            "cache-control": "no-store", "x-content-type-options": "nosniff",
          }
          result.headers.forEach((value, name) => { if (name !== "set-cookie") headers[name] = value })
          const setCookie = result.headers.getSetCookie()
          if (result.status === 401 && authorization === undefined && header(request.headers.cookie) !== undefined && setCookie.length === 0) {
            setCookie.push(browserSession.clearCookie)
          }
          if (setCookie.length > 0) headers["set-cookie"] = setCookie
          response.writeHead(result.status, headers)
          response.end(body)
        } catch (error) {
          if (error instanceof Error && error.message === "request_body_too_large") send(response, 413, { error: "request_body_too_large" })
          else send(response, 500, { error: "internal_failure" })
        }
        return
      }
      const ui = staticUiResponse(request.method, path)
      if (ui !== undefined) { send(response, ui.status, ui.body, ui.headers); return }
      const result = route(request.method, path, isReady())
      send(response, result.status, result.body)
    })()
  })
  const close = (): Promise<void> => closePromise ??= (async () => {
    try {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      }))
    } finally {
      await dispose()
    }
  })()
  server.once("close", () => { void dispose() })
  try {
    await listen(server, config)
  } catch (error) {
    await dispose()
    throw error
  }
  console.log(`QWBE Invoicing listening on http://${config.host}:${String(config.port)}`)
  return { server, close }
}
