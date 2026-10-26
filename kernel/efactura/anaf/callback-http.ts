import { HttpServerResponse, type HttpServerRequest } from "@effect/platform"
import { Cause, Effect, Option, Redacted } from "effect"

import {
  OAUTH_ATTEMPT_TTL_SECONDS, attemptUntouched, callbackTarget, type CallbackInput, type CallbackOutcome,
} from "../../../cubes/invoicing/efactura/connection/index.ts"
import { sessionCookieValues } from "../../auth/browser-session-helpers.ts"
import { logInternalFailure } from "../../failure-log.ts"

/**
 * The attempt cookie: the nonce of the browser's current attempt, sent only to
 * `/api/anaf/*`, and SameSite=Lax because ANAF brings the browser back with a
 * top-level GET from another site. It is the callback's only credential.
 */
const ATTEMPT_COOKIE = "qwbe_anaf_oauth"
const ATTEMPT_ATTRIBUTES = "Path=/api/anaf; HttpOnly; Secure; SameSite=Lax"
const NONCE = /^[A-Za-z0-9_-]{43}$/u

export const attemptCookie = (nonce: Redacted.Redacted): string =>
  `${ATTEMPT_COOKIE}=${Redacted.value(nonce)}; Max-Age=${String(OAUTH_ATTEMPT_TTL_SECONDS)}; ${ATTEMPT_ATTRIBUTES}`

export const clearedAttemptCookie = `${ATTEMPT_COOKIE}=; Max-Age=0; ${ATTEMPT_ATTRIBUTES}`

/** One well-formed cookie and one `code`, or nothing: a repeated value is never guessed at. */
const callbackInput = (request: HttpServerRequest.HttpServerRequest): CallbackInput => {
  const query = new URL(request.url, "http://qwbe.invalid").searchParams
  const cookies = sessionCookieValues(request.headers.cookie, ATTEMPT_COOKIE)
  const [nonce] = cookies
  const codes = query.getAll("code")
  return {
    nonce: cookies.length === 1 && nonce !== undefined && NONCE.test(nonce) ? Redacted.make(nonce) : undefined,
    code: codes.length === 1 ? codes[0] : undefined,
    refused: query.has("error"),
  }
}

/** Only the failure's tag and fixed operation reach the log: never the query, the cookie or a token. */
const failed = (cause: Cause.Cause<{ readonly _tag: string; readonly operation?: string }>): Effect.Effect<CallbackOutcome> => {
  const failure = Cause.failureOption(cause)
  const reason = Option.isSome(failure) ? [failure.value._tag, failure.value.operation ?? ""].join(" ").trim() : "defect"
  logInternalFailure({ kind: "server_failure", reason: `e-Factura callback: ${reason}` })
  return Effect.succeed("eroare")
}

/**
 * `GET /api/anaf/callback`: whatever happened, a 303 to the one fixed page with
 * a fixed code, nothing cached and no referrer. The attempt cookie is cleared
 * unless the answer left the attempt untouched (`error=` or no code), so a
 * foreign page cannot cancel a connection the owner has started.
 */
export const anafCallbackResponse = <E extends { readonly _tag: string; readonly operation?: string }>(
  complete: (input: CallbackInput) => Effect.Effect<CallbackOutcome, E>,
  request: HttpServerRequest.HttpServerRequest,
) => Effect.suspend(() => complete(callbackInput(request))).pipe(
  Effect.catchAllCause(failed),
  Effect.map((outcome) => HttpServerResponse.redirect(callbackTarget(outcome), { status: 303, headers: {
    ...(attemptUntouched(outcome) ? {} : { "set-cookie": clearedAttemptCookie }),
    "cache-control": "no-store", "referrer-policy": "no-referrer",
  } })))
