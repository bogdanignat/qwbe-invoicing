import { Cause, Data, Effect, Exit, Option, Ref } from "effect"

import type { Decoder } from "./models.ts"

export class ApiFailure extends Data.TaggedError("ApiFailure")<{
  readonly message: string
  readonly status?: number
  readonly code?: string
  readonly issues: ReadonlyArray<string>
}> {}

interface RequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "DELETE"
  readonly body?: Readonly<Record<string, unknown>>
}

const tokenRef = Effect.runSync(Ref.make<string | undefined>(undefined))
const unauthorizedListeners = new Set<() => void>()

export const setApiToken = (token: string): Effect.Effect<void> => Ref.set(tokenRef, token.trim())
export const clearApiToken = Ref.set(tokenRef, undefined)
export const onUnauthorized = (listener: () => void): (() => void) => {
  unauthorizedListeners.add(listener)
  return () => { unauthorizedListeners.delete(listener) }
}

const parseFailure = (input: unknown, status: number): ApiFailure => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return new ApiFailure({ message: `Cererea a eșuat (${String(status)}).`, status, issues: [] })
  }
  const value = input as Readonly<Record<string, unknown>>
  const code = typeof value.code === "string" ? value.code : undefined
  const issues = Array.isArray(value.issues) ? value.issues.filter((issue): issue is string => typeof issue === "string") : []
  const message = typeof value.message === "string"
    ? value.message
    : issues[0] ?? (typeof value.error === "string" ? value.error : `Cererea a eșuat (${String(status)}).`)
  return new ApiFailure({ message, status, issues, ...(code === undefined ? {} : { code }) })
}

const fetchResponse = (path: string, options: RequestOptions): Effect.Effect<Response, ApiFailure> => Effect.gen(function*() {
  const token = yield* Ref.get(tokenRef)
  if (token === undefined || token.length === 0) {
    return yield* Effect.fail(new ApiFailure({ message: "Sesiunea API nu este deblocată.", status: 401, issues: [] }))
  }
  return yield* Effect.tryPromise({
    try: (signal) => fetch(path, {
      method: options.method ?? "GET",
      signal,
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    catch: (cause) => new ApiFailure({ message: cause instanceof Error ? cause.message : "Conexiunea cu API-ul a eșuat.", issues: [] }),
  })
})

const readJson = (response: Response): Effect.Effect<unknown, ApiFailure> => Effect.tryPromise({
  try: () => response.json() as Promise<unknown>,
  catch: () => new ApiFailure({ message: "API-ul a returnat un răspuns JSON invalid.", status: response.status, issues: [] }),
})

const authorizeResponse = (response: Response): Effect.Effect<Response, ApiFailure> => Effect.gen(function*() {
  if (response.status === 401) {
    yield* clearApiToken
    for (const listener of unauthorizedListeners) listener()
  }
  if (!response.ok) {
    const body = yield* readJson(response).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    return yield* Effect.fail(parseFailure(body, response.status))
  }
  return response
})

export const apiRequest = <Value>(path: string, decode: Decoder<Value>, options: RequestOptions = {}): Effect.Effect<Value, ApiFailure> => Effect.gen(function*() {
  const response = yield* fetchResponse(path, options)
  yield* authorizeResponse(response)
  const payload = yield* readJson(response)
  return yield* Effect.try({
    try: () => decode(payload),
    catch: (cause) => new ApiFailure({ message: cause instanceof Error ? cause.message : "Forma răspunsului API este invalidă.", status: response.status, issues: [] }),
  })
})

export const apiBlob = (path: string, options: RequestOptions = {}): Effect.Effect<Blob, ApiFailure> => Effect.gen(function*() {
  const response = yield* fetchResponse(path, options)
  yield* authorizeResponse(response)
  return yield* Effect.tryPromise({
    try: () => response.blob(),
    catch: () => new ApiFailure({ message: "Nu am putut citi documentul primit.", status: response.status, issues: [] }),
  })
})

export const runUiEffect = async <Value>(effect: Effect.Effect<Value, ApiFailure>, signal?: AbortSignal): Promise<Value> => {
  const exit = signal === undefined ? await Effect.runPromiseExit(effect) : await Effect.runPromiseExit(effect, { signal })
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.failureOption(exit.cause)
  if (Option.isSome(failure)) throw failure.value
  throw Cause.squash(exit.cause)
}
