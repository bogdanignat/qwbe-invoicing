import { HttpServerRequest } from "@effect/platform"
import { Effect, Layer, Redacted } from "effect"

import type { RequestContext } from "../../cubes/invoicing/index.ts"
import { ApiAuthentication, SessionAuthentication } from "./http-api.ts"
import type { ApiRuntime } from "./api-types.ts"

type ContextFailure = { readonly error: "AuthenticationRequired" } | { readonly error: "OrganizationContextMissing" }
const principal = (runtime: ApiRuntime, authorization: string): Effect.Effect<RequestContext, ContextFailure> =>
  Effect.mapError(runtime.authenticate(authorization).current, (failure) => ({ error: failure._tag }))

export const authenticationLayer = (runtime: ApiRuntime) => Layer.succeed(ApiAuthentication, {
  // The platform slices any 7-character prefix off the header; the raw header
  // goes to the authenticator instead, so its parser alone decides the scheme.
  bearerAuth: () => Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
    principal(runtime, request.headers.authorization ?? "")),
  sessionCookie: (cookie) => Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (request.headers.authorization !== undefined) return yield* Effect.fail({ error: "AuthenticationRequired" as const })
    const value = Redacted.value(cookie)
    const session = runtime.browserSession
    if (session === undefined || value.length === 0) return yield* Effect.fail({ error: "AuthenticationRequired" as const })
    // The session is a query now: the generator awaits it instead of reading it.
    const authorization = yield* Effect.promise(() => session.authorize({
      cookie: `qwbe_session=${value}`, method: request.method,
      csrfToken: request.headers["x-csrf-token"], origin: request.headers.origin, host: request.headers.host,
    }))
    if (authorization.kind === "forbidden") return yield* Effect.fail({ error: "csrf_validation_failed" as const })
    if (authorization.kind === "unauthorized") return yield* Effect.fail({ error: "AuthenticationRequired" as const })
    return yield* principal(runtime, authorization.authorization)
  }),
})

const authenticationRequired = Effect.fail({ error: "AuthenticationRequired" as const })

export const sessionAuthenticationLayer = (runtime: ApiRuntime) => Layer.succeed(SessionAuthentication, {
  sessionCookie: (cookie) => {
    const value = Redacted.value(cookie)
    const header = `qwbe_session=${value}`
    const session = runtime.browserSession
    if (session === undefined || value.length === 0) return authenticationRequired
    // `Layer.succeed` with a synchronous body is gone: resuming reads the
    // database, so the answer is an Effect that awaits it.
    return Effect.flatMap(
      Effect.promise(() => session.resume(header)),
      (resumed) => resumed.kind === "unauthorized"
        ? authenticationRequired
        : Effect.succeed({ csrfToken: resumed.csrfToken, cookie: header }),
    )
  },
})
