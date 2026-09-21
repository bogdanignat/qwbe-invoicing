import type { IncomingMessage, RequestListener } from "node:http"

import { Effect, Either } from "effect"

import type { ApiHandler } from "../api/api.ts"
import type { RequestAuthenticator } from "../auth/auth.ts"
import { hasBearerCredential } from "../auth/auth.ts"
import type { BrowserSession } from "../auth/browser-session.ts"
import { loginPeerKey, type LoginThrottle } from "../auth/login-throttle.ts"
import { failureReason, logInternalFailure } from "../failure-log.ts"
import { staticUiResponse } from "./static-ui.ts"
import { header, readRawBody, send, webRequest } from "./http-request-io.ts"

interface HttpResponse {
  readonly status: number
  readonly body: Readonly<Record<string, string>>
}

export const route = (method: string | undefined, url: string | undefined, ready: boolean): HttpResponse => {
  if (method !== "GET") return { status: 405, body: { status: "method_not_allowed" } }
  if (url === "/health/live") return { status: 200, body: { status: "live" } }
  if (url === "/health/ready") return ready ? { status: 200, body: { status: "ready" } } : { status: 503, body: { status: "not_ready" } }
  if (url === "/") return { status: 200, body: { application: "QWBE Invoicing", status: "invoice_core" } }
  return { status: 404, body: { status: "not_found" } }
}

interface ListenerDependencies {
  readonly authenticate: RequestAuthenticator
  readonly browserSession: BrowserSession
  readonly throttle: LoginThrottle
  readonly api: ApiHandler
  readonly isReady: () => boolean
  readonly renderApiDocs: () => Promise<{ readonly status: number; readonly body: unknown; readonly headers: Readonly<Record<string, string>> }>
  readonly peerKey?: (request: IncomingMessage) => string | undefined
}

export const createRequestListener = (dependencies: ListenerDependencies): RequestListener => (request, response) => {
  const { api, authenticate, browserSession, isReady, renderApiDocs, throttle } = dependencies
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
      catch (error) {
        logInternalFailure({ kind: "api_docs", reason: failureReason(error) })
        send(response, 500, { error: "internal_failure" })
      }
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
        const headers: Record<string, string | string[]> = { "cache-control": "no-store", "x-content-type-options": "nosniff" }
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
        else {
          logInternalFailure({ kind: "request", reason: failureReason(error) })
          send(response, 500, { error: "internal_failure" })
        }
      }
      return
    }
    const ui = staticUiResponse(request.method, path)
    if (ui !== undefined) { send(response, ui.status, ui.body, ui.headers); return }
    const result = route(request.method, path, isReady())
    send(response, result.status, result.body)
  })()
}
