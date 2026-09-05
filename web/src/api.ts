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
  readonly body?: object
  readonly idempotencyKey?: string
}

const csrfTokenRef = Effect.runSync(Ref.make<string | undefined>(undefined))
const unauthorizedListeners = new Set<() => void>()
const failureMessages: Readonly<Record<string, string>> = {
  AuthenticationRequired: "Sesiunea a expirat. Introdu din nou tokenul API.",
  csrf_validation_failed: "Sesiunea nu a putut valida cererea. Reîncarcă pagina și încearcă din nou.",
  invalid_credentials: "Tokenul API este incorect.",
  origin_not_allowed: "Originea cererii de autentificare nu este permisă.",
  ResourceNotFound: "Resursa cerută nu mai există. Reîncarcă pagina și încearcă din nou.",
  customer_has_open_drafts: "Clientul are drafturi deschise.",
  document_series_exists: "Seria există deja pentru acest tip de document.",
  invoice_already_corrected: "Factura are deja un document storno integral.",
  draft_already_issued: "Draftul a fost deja emis și nu mai poate fi folosit pentru un alt document.",
  proforma_already_converted: "Proforma a fost deja transformată într-un draft de factură.",
  invoice_already_issued: "Draftul a fost deja emis ca factură și este blocat.",
  idempotency_key_reused: "Cheia de siguranță a fost folosită pentru altă cerere. Reîncarcă pagina înainte de a continua.",
}

export const clearApiSession = Ref.set(csrfTokenRef, undefined)
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
  const error = typeof value.error === "string" ? value.error : undefined
  const localizedCode = code === undefined ? undefined : failureMessages[code]
  const message = localizedCode ?? (typeof value.message === "string"
    ? value.message
    : issues[0] ?? (code === undefined ? (error === undefined ? `Cererea a eșuat (${String(status)}).` : failureMessages[error] ?? error) : error ?? code))
  return new ApiFailure({ message, status, issues, ...(code === undefined ? {} : { code }) })
}

const request = (path: string, init: RequestInit): Effect.Effect<Response, ApiFailure> => Effect.tryPromise({
  try: (signal) => fetch(path, { ...init, signal, credentials: "same-origin" }),
  catch: (cause) => new ApiFailure({ message: cause instanceof Error ? cause.message : "Conexiunea cu API-ul a eșuat.", issues: [] }),
})

const fetchResponse = (path: string, options: RequestOptions): Effect.Effect<Response, ApiFailure> => Effect.gen(function*() {
  const csrfToken = yield* Ref.get(csrfTokenRef)
  if (csrfToken === undefined || csrfToken.length === 0) {
    return yield* Effect.fail(new ApiFailure({ message: "Sesiunea API nu este deblocată.", status: 401, issues: [] }))
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

const readJson = (response: Response): Effect.Effect<unknown, ApiFailure> => Effect.tryPromise({
  try: () => response.json() as Promise<unknown>,
  catch: () => new ApiFailure({ message: "API-ul a returnat un răspuns JSON invalid.", status: response.status, issues: [] }),
})

const authorizeResponse = (response: Response): Effect.Effect<Response, ApiFailure> => Effect.gen(function*() {
  if (response.status === 401) {
    yield* clearApiSession
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

const decodeSession = (input: unknown): string => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Forma sesiunii este invalidă.")
  const value = input as Readonly<Record<string, unknown>>
  if (value.authenticated !== true || typeof value.csrfToken !== "string" || value.csrfToken.length === 0) {
    throw new Error("Forma sesiunii este invalidă.")
  }
  return value.csrfToken
}

const establishSession = (response: Response): Effect.Effect<void, ApiFailure> => Effect.gen(function*() {
  if (!response.ok) {
    yield* clearApiSession
    const body = yield* readJson(response).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    return yield* Effect.fail(parseFailure(body, response.status))
  }
  const body = yield* readJson(response)
  const csrfToken = yield* Effect.try({
    try: () => decodeSession(body),
    catch: (cause) => new ApiFailure({ message: cause instanceof Error ? cause.message : "Forma sesiunii este invalidă.", status: response.status, issues: [] }),
  })
  yield* Ref.set(csrfTokenRef, csrfToken)
})

export const loginApiSession = (token: string): Effect.Effect<void, ApiFailure> => Effect.gen(function*() {
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
  const response = yield* request("/api/session", { method: "DELETE", headers: { "x-csrf-token": csrfToken } })
  if (response.status === 401) return
  if (!response.ok) {
    const body = yield* readJson(response).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    return yield* Effect.fail(parseFailure(body, response.status))
  }
}).pipe(Effect.ensuring(clearApiSession))
