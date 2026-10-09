import type { IncomingMessage, RequestListener } from "node:http"

import type { ApiHandler } from "../api/api.ts"
import type { RequestAuthenticator } from "../auth/auth.ts"
import type { BrowserSession } from "../auth/browser-session.ts"
import { loginPeerKey, type LoginThrottle } from "../auth/login-throttle.ts"
import { failureReason, logInternalFailure } from "../failure-log.ts"
import { forwardApiRequest } from "./http-api-forward.ts"
import { header, send } from "./http-request-io.ts"

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

/**
 * Which paths are allowed to pay for a readiness evaluation. Only
 * `/health/ready` is: liveness, the root document and the 404/405 answers are
 * decided without touching the database, so a slow or absent server cannot turn
 * a liveness probe into a restart loop. `route` still takes `ready` as a
 * parameter — it stays synchronous — and the caller passes `false` for the paths
 * that never consult it, which `route` ignores anyway.
 */
const needsReadiness = (url: string | undefined): boolean => url === "/health/ready"

interface ListenerDependencies {
  readonly authenticate: RequestAuthenticator
  readonly browserSession: BrowserSession
  readonly throttle: LoginThrottle
  readonly api: ApiHandler
  readonly isReady: () => Promise<boolean>
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
      // Everything on this branch can reject now: readiness opens a transaction
      // and `resume` is a locked read. One try/catch covers all three, so a
      // database failure answers the request instead of escaping the IIFE as an
      // unhandled rejection and taking the process with it.
      try {
        if (!await isReady()) { send(response, 503, { error: "not_ready" }); return }
        const session = await browserSession.resume(header(request.headers.cookie))
        if (session.kind === "unauthorized") {
          send(response, 401, { error: "AuthenticationRequired" }, { "set-cookie": browserSession.clearCookie }); return
        }
        const docs = await renderApiDocs()
        send(response, docs.status, docs.body, docs.headers)
      } catch (error) {
        logInternalFailure({ kind: "api_docs", reason: failureReason(error) })
        send(response, 500, { error: "internal_failure" })
      }
      return
    }
    if (path?.startsWith("/api/") === true) {
      await forwardApiRequest({ api, authenticate, browserSession, isReady, peer, rejectCooldown, throttle }, request, response, path)
      return
    }
    // `/health/live`, `/` and the fallbacks answer without the database;
    // `/health/ready` is the only path that pays for an evaluation.
    const ready = needsReadiness(path) ? await isReady() : false
    const result = route(request.method, path, ready)
    send(response, result.status, result.body)
  })().catch((error: unknown) => {
    // The outer net: every branch above has its own catch, and this one exists
    // so a defect in the dispatch itself still answers the request instead of
    // becoming an unhandled rejection. There is deliberately NO process-level
    // `unhandledRejection` handler anywhere in the application: it would hide
    // exactly this class of bug instead of surfacing it.
    logInternalFailure({ kind: "request", reason: failureReason(error) })
    if (!response.headersSent) send(response, 500, { error: "internal_failure" })
    else response.end()
  })
}
