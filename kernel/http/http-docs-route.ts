import type { IncomingMessage, ServerResponse } from "node:http"

import type { BrowserSession } from "../auth/browser-session.ts"
import { sessionCookieValues } from "../auth/browser-session-helpers.ts"
import { failureReason, logInternalFailure } from "../failure-log.ts"
import type { ApiDocsResponse } from "./api-docs.ts"
import { untilAborted } from "./edge-deadline.ts"
import { header, send } from "./http-request-io.ts"

export interface DocsRoute {
  readonly browserSession: BrowserSession
  readonly isReady: () => Promise<boolean>
  readonly renderApiDocs: () => Promise<ApiDocsResponse>
}

/**
 * `GET /api`, the Swagger page. A missing or invalid session is sent to
 * `/unlock` (303); the session cookie is cleared only when the request carried
 * one. The cookie is SameSite=Strict, so a cross-site link arrives without it,
 * and clearing it then would log the owner out from any page. Every other
 * answer keeps its status: 503 while not ready, 500 when rendering fails. Each
 * await is bounded by the request's signal, and one try/catch covers all three,
 * so a database failure answers the request instead of escaping as an unhandled
 * rejection.
 */
export const serveApiDocs = async (
  route: DocsRoute,
  request: IncomingMessage,
  response: ServerResponse,
  signal: AbortSignal,
): Promise<void> => {
  const { browserSession, isReady, renderApiDocs } = route
  try {
    if (!await untilAborted(isReady(), signal)) { send(response, 503, { error: "not_ready" }); return }
    const cookie = header(request.headers.cookie)
    const session = await untilAborted(browserSession.resume(cookie), signal)
    if (session.kind === "unauthorized") {
      send(response, 303, new Uint8Array(), {
        "cache-control": "no-store",
        location: "/unlock",
        ...(sessionCookieValues(cookie).length > 0 ? { "set-cookie": browserSession.clearCookie } : {}),
      })
      return
    }
    const docs = await untilAborted(renderApiDocs(), signal)
    send(response, docs.status, docs.body, docs.headers)
  } catch (error) {
    if (signal.aborted) return
    logInternalFailure({ kind: "api_docs", reason: failureReason(error) })
    send(response, 500, { error: "internal_failure" })
  }
}
