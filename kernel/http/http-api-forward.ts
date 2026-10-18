import type { IncomingMessage, ServerResponse } from "node:http"

import { Effect, Either } from "effect"

import type { ApiHandler } from "../api/api.ts"
import type { RequestAuthenticator } from "../auth/auth.ts"
import { hasBearerCredential } from "../auth/auth.ts"
import type { BrowserSession } from "../auth/browser-session.ts"
import type { LoginThrottle } from "../auth/login-throttle.ts"
import { failureReason, logInternalFailure } from "../failure-log.ts"
import { header, readRawBody, send, webRequest } from "./http-request-io.ts"

/**
 * The `/api/*` branch, lifted out of the listener so both stay inside the
 * per-file budget. It owns one thing: turning a Node request into the Effect
 * handler's `Request` and back, with the login throttle on the credential paths.
 *
 * Everything it awaits is inside the try: readiness, the body read and the
 * handler itself all reject now that storage is remote, and a rejection that
 * escaped would be an unhandled rejection rather than a 500.
 */
export interface ApiForward {
  readonly api: ApiHandler
  readonly authenticate: RequestAuthenticator
  readonly browserSession: BrowserSession
  readonly isReady: () => Promise<boolean>
  readonly peer: string
  readonly rejectCooldown: () => boolean
  readonly throttle: LoginThrottle
}

export const forwardApiRequest = async (
  forward: ApiForward,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<void> => {
  const { api, authenticate, browserSession, isReady, peer, rejectCooldown, throttle } = forward
  try {
    if (!await isReady()) { send(response, 503, { error: "not_ready" }); return }
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
}
