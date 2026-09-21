import { Effect, Ref } from "effect"
import { ApiFailure, parseApiFailure } from "./api-errors.ts"
import { clearApiSession, csrfTokenRef } from "./api-session-state.ts"
import { readJson, request } from "./api-transport.ts"

const decodeSession = (input: unknown): string => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Forma sesiunii este invalidă.")
  }
  const value = input as Readonly<Record<string, unknown>>
  if (value.authenticated !== true
    || typeof value.csrfToken !== "string"
    || value.csrfToken.length === 0) {
    throw new Error("Forma sesiunii este invalidă.")
  }
  return value.csrfToken
}

const establishSession = (response: Response): Effect.Effect<void, ApiFailure> =>
  Effect.gen(function*() {
    if (!response.ok) {
      yield* clearApiSession
      const body = yield* readJson(response).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
      return yield* Effect.fail(parseApiFailure(body, response.status))
    }
    const body = yield* readJson(response)
    const csrfToken = yield* Effect.try({
      try: () => decodeSession(body),
      catch: (cause) => new ApiFailure({
        message: cause instanceof Error ? cause.message : "Forma sesiunii este invalidă.",
        status: response.status,
        issues: [],
      }),
    })
    yield* Ref.set(csrfTokenRef, csrfToken)
  })

export const loginApiSession = (token: string): Effect.Effect<void, ApiFailure> =>
  Effect.gen(function*() {
    const response = yield* request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: token.trim() }),
    })
    yield* establishSession(response)
  })

export const restoreApiSession: Effect.Effect<void, ApiFailure> = Effect.gen(function*() {
  const response = yield* request("/api/session", { method: "GET" })
  yield* establishSession(response)
})

export const logoutApiSession: Effect.Effect<void, ApiFailure> = Effect.gen(function*() {
  let csrfToken = yield* Ref.get(csrfTokenRef)
  if (csrfToken === undefined) {
    yield* restoreApiSession
    csrfToken = yield* Ref.get(csrfTokenRef)
  }
  if (csrfToken === undefined) return
  const response = yield* request("/api/session", {
    method: "DELETE",
    headers: { "x-csrf-token": csrfToken },
  })
  if (response.status === 401) return
  if (!response.ok) {
    const body = yield* readJson(response).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    return yield* Effect.fail(parseApiFailure(body, response.status))
  }
}).pipe(Effect.ensuring(clearApiSession))
