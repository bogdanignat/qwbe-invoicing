import { Effect, Ref } from "effect"
import { ApiFailure, parseApiFailure } from "./api-errors.ts"
import { clearApiSession, csrfTokenRef, unauthorizedListeners } from "./api-session-state.ts"
import type { Decoder } from "./model-decoder.ts"

export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "DELETE"
  readonly body?: object
  readonly idempotencyKey?: string
}

export const request = (path: string, init: RequestInit): Effect.Effect<Response, ApiFailure> =>
  Effect.tryPromise({
    try: (signal) => fetch(path, { ...init, signal, credentials: "same-origin" }),
    catch: (cause) => new ApiFailure({
      message: cause instanceof Error ? cause.message : "Conexiunea cu API-ul a eșuat.",
      issues: [],
    }),
  })

export const readJson = (response: Response): Effect.Effect<unknown, ApiFailure> =>
  Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: () => new ApiFailure({
      message: "API-ul a returnat un răspuns JSON invalid.",
      status: response.status,
      issues: [],
    }),
  })

const fetchResponse = (
  path: string,
  options: RequestOptions,
): Effect.Effect<Response, ApiFailure> => Effect.gen(function*() {
  const csrfToken = yield* Ref.get(csrfTokenRef)
  if (csrfToken === undefined || csrfToken.length === 0) {
    return yield* Effect.fail(new ApiFailure({
      message: "Sesiunea API nu este deblocată.",
      status: 401,
      issues: [],
    }))
  }
  const method = options.method ?? "GET"
  return yield* request(path, {
    method,
    headers: {
      ...(method === "GET" ? {} : { "x-csrf-token": csrfToken }),
      ...(options.idempotencyKey === undefined ? {} : { "idempotency-key": options.idempotencyKey }),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
})

const authorizeResponse = (response: Response): Effect.Effect<Response, ApiFailure> =>
  Effect.gen(function*() {
    if (response.status === 401) {
      yield* clearApiSession
      for (const listener of unauthorizedListeners) listener()
    }
    if (!response.ok) {
      const body = yield* readJson(response).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
      return yield* Effect.fail(parseApiFailure(body, response.status))
    }
    return response
  })

export const apiRequest = <Value>(
  path: string,
  decode: Decoder<Value>,
  options: RequestOptions = {},
): Effect.Effect<Value, ApiFailure> => Effect.gen(function*() {
  const response = yield* fetchResponse(path, options)
  yield* authorizeResponse(response)
  const payload = yield* readJson(response)
  return yield* Effect.try({
    try: () => decode(payload),
    catch: (cause) => new ApiFailure({
      message: cause instanceof Error ? cause.message : "Forma răspunsului API este invalidă.",
      status: response.status,
      issues: [],
    }),
  })
})

export const apiBlob = (
  path: string,
  options: RequestOptions = {},
): Effect.Effect<Blob, ApiFailure> => Effect.gen(function*() {
  const response = yield* fetchResponse(path, options)
  yield* authorizeResponse(response)
  return yield* Effect.tryPromise({
    try: () => response.blob(),
    catch: () => new ApiFailure({
      message: "Nu am putut citi documentul primit.",
      status: response.status,
      issues: [],
    }),
  })
})
