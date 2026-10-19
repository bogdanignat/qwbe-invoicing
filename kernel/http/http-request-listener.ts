import type { IncomingMessage, RequestListener } from "node:http"

import type { ApiHandler } from "../api/api.ts"
import type { RequestAuthenticator } from "../auth/auth.ts"
import type { BrowserSession } from "../auth/browser-session.ts"
import { loginPeerKey, type LoginThrottle } from "../auth/login-throttle.ts"
import { clientAddress, type ClientAddress } from "./client-address.ts"
import type { TrustedProxies } from "./trusted-proxy.ts"
import { failureReason, logInternalFailure } from "../failure-log.ts"
import type { ApiDocsResponse } from "./api-docs.ts"
import { requestDeadlineMs, startDeadline, untilAborted } from "./edge-deadline.ts"
import { edgeRefusal, type EdgePolicy } from "./edge-guard.ts"
import { requestTarget } from "./edge-target.ts"
import { forwardApiRequest } from "./http-api-forward.ts"
import { serveApiDocs } from "./http-docs-route.ts"
import { send } from "./http-request-io.ts"
import type { UiBundle } from "./ui-bundle.ts"
import { serveUi, uiPath } from "./ui-route.ts"

interface HttpResponse {
  readonly status: number
  readonly body: Readonly<Record<string, string>>
}

export const route = (method: string | undefined, path: string, ready: boolean): HttpResponse => {
  if (method !== "GET") return { status: 405, body: { status: "method_not_allowed" } }
  if (path === "/health/live" || path === "/healthz") return { status: 200, body: { status: "live" } }
  if (path === "/health/ready") return ready ? { status: 200, body: { status: "ready" } } : { status: 503, body: { status: "not_ready" } }
  return { status: 404, body: { status: "not_found" } }
}

/**
 * Which paths are allowed to pay for a readiness evaluation. Only
 * `/health/ready` is: liveness (`/health/live` and its alias `/healthz`), the
 * UI and the 404/405 answers are decided without touching the database, so a slow or absent server cannot turn a liveness probe into a
 * restart loop. `route` stays synchronous and the caller passes `false` for the
 * paths that never consult readiness.
 */
const needsReadiness = (path: string): boolean => path === "/health/ready"

interface ListenerDependencies {
  readonly authenticate: RequestAuthenticator
  readonly browserSession: BrowserSession
  readonly throttle: LoginThrottle
  readonly api: ApiHandler
  readonly isReady: () => Promise<boolean>
  readonly renderApiDocs: () => Promise<ApiDocsResponse>
  /** The Vite build, loaded once at startup; `undefined` when the server runs without a UI. */
  readonly ui: UiBundle | undefined
  /** The public edge. Known once the server listens; before that nothing is served. */
  readonly edge: () => EdgePolicy | undefined
  readonly deadlineMs?: number
  readonly trustedProxies: TrustedProxies
  readonly peerKey?: (request: IncomingMessage) => string | undefined
}

/**
 * The order is the security contract: the deadline starts first, the raw
 * request-target and the edge guard run before the path is branched on, before
 * readiness, before the body is read and before a credential is looked at.
 * Then the API and the health checks, then the SPA: a file of the build, else
 * `index.html`.
 */
export const createRequestListener = (dependencies: ListenerDependencies): RequestListener => (request, response) => {
  const { api, authenticate, browserSession, isReady, throttle } = dependencies
  const signal = startDeadline(response, dependencies.deadlineMs ?? requestDeadlineMs, () => {
    if (response.headersSent) response.destroy()
    else send(response, 504, { error: "upstream_timeout" }, { connection: "close" })
  })
  void (async () => {
    // A refused request is answered without reading its body, and its
    // connection is not kept for another one.
    const target = requestTarget(request.url)
    if (target === undefined) { send(response, 400, { error: "invalid_request_target" }, { connection: "close" }); return }
    const edge = dependencies.edge()
    if (edge === undefined) { send(response, 503, { error: "not_ready" }); return }
    const refusal = edgeRefusal(request, target.path, edge)
    if (refusal !== undefined) { send(response, refusal.status, { error: refusal.error }, { connection: "close" }); return }
    const client: ClientAddress = dependencies.peerKey === undefined
      ? clientAddress(request, dependencies.trustedProxies)
      : { kind: "client", address: dependencies.peerKey(request) }
    if (client.kind === "invalid") { send(response, 400, { error: "invalid_forwarded_for" }, { connection: "close" }); return }
    const peer = loginPeerKey(client.address)
    const rejectCooldown = (): boolean => {
      const retryAfter = throttle.check(peer)
      if (retryAfter === 0) return false
      send(response, 429, { error: "too_many_attempts" }, { "retry-after": String(retryAfter) })
      return true
    }
    const { path } = target
    if (path === "/api" && request.method === "GET") {
      await serveApiDocs(dependencies, request, response, signal)
      return
    }
    if (path.startsWith("/api/")) {
      const forward = { api, authenticate, browserSession, isReady, origin: edge.origin, peer, rejectCooldown, signal, throttle }
      await forwardApiRequest(forward, request, response, path)
      return
    }
    if (uiPath(path)) { serveUi(dependencies.ui, request.method, path, response); return }
    const ready = needsReadiness(path) ? await untilAborted(isReady(), signal) : false
    const result = route(request.method, path, ready)
    send(response, result.status, result.body)
  })().catch((error: unknown) => {
    // The outer net: every branch above has its own catch, and this one exists
    // so a defect in the dispatch itself still answers the request instead of
    // becoming an unhandled rejection. There is deliberately NO process-level
    // `unhandledRejection` handler anywhere in the application: it would hide
    // exactly this class of bug instead of surfacing it. An aborted request was
    // already answered (or has no one left to answer).
    if (signal.aborted) return
    logInternalFailure({ kind: "request", reason: failureReason(error) })
    if (!response.headersSent) send(response, 500, { error: "internal_failure" })
    else response.end()
  })
}
