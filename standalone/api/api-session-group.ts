import { HttpApiBuilder, HttpServerResponse } from "@effect/platform"
import { Effect, Schema } from "effect"

import { CurrentSession, applicationHttpApi } from "./http-api.ts"
import type { ApiRuntime } from "./api-types.ts"
import { LoginInput } from "./schema-errors-session.ts"

export const sessionsGroup = (runtime: ApiRuntime) => HttpApiBuilder.group(applicationHttpApi, "sessions", (handlers) => handlers
  .handle("getSession", () => Effect.map(CurrentSession, ({ csrfToken }) => ({ authenticated: true as const, csrfToken })))
  .handleRaw("createSession", ({ request }) => Effect.gen(function*() {
    const session = runtime.browserSession
    if (session === undefined) return HttpServerResponse.unsafeJson({ error: "not_found" }, { status: 404 })
    const raw = yield* Effect.either(request.json)
    if (raw._tag === "Left") return HttpServerResponse.unsafeJson({ error: "invalid_json" }, { status: 400 })
    const decoded = Schema.decodeUnknownEither(LoginInput, { errors: "all" })(raw.right)
    if (decoded._tag === "Left" || decoded.right.token.trim().length === 0) {
      return HttpServerResponse.unsafeJson({ error: "invalid_credentials" }, { status: 400 })
    }
    const login = session.login({ token: decoded.right.token, origin: request.headers.origin, host: request.headers.host })
    if (login.kind === "forbidden") return HttpServerResponse.unsafeJson({ error: "origin_not_allowed" }, { status: 403 })
    if (login.kind === "unauthorized") return HttpServerResponse.unsafeJson({ error: "invalid_credentials" }, {
      status: 401, headers: { "set-cookie": session.clearCookie },
    })
    return HttpServerResponse.unsafeJson({ authenticated: true, csrfToken: login.csrfToken }, {
      headers: { "set-cookie": login.setCookie },
    })
  }))
  .handleRaw("deleteSession", ({ headers, request }) => Effect.map(CurrentSession, (current) => {
    const session = runtime.browserSession
    const authorized = session?.authorize({ cookie: current.cookie, method: "DELETE", csrfToken: headers["x-csrf-token"],
      origin: request.headers.origin, host: request.headers.host })
    if (session === undefined || authorized?.kind !== "authorized") {
      return HttpServerResponse.unsafeJson({ error: "csrf_validation_failed" }, { status: 403 })
    }
    session.revoke(current.cookie)
    return HttpServerResponse.unsafeJson({ authenticated: false }, { headers: { "set-cookie": session.clearCookie } })
  })))
