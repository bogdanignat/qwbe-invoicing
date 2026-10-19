import { Effect, ParseResult, type Schema } from "effect"

import { ProviderFailure } from "../../cubes/invoicing/company-lookup/index.ts"

/** `fetch` in production; a fake in the tests, which never reach the network. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>

export interface ProviderHttpOptions {
  readonly transport: Transport
  /** The whole exchange, body included. */
  readonly timeoutMs?: number
}

export interface ProviderReply {
  readonly status: number
  readonly headers: Headers
  readonly text: string
}

export const TIMEOUT_MS = 5_000
export const MAX_BODY_BYTES = 256 * 1024

export const unavailable = (): ProviderFailure => new ProviderFailure({ reason: "unavailable" })

const readBounded = async (response: Response, signal: AbortSignal): Promise<string> => {
  const declared = Number(response.headers.get("content-length") ?? "0")
  if (declared > MAX_BODY_BYTES) throw new Error("body too large")
  if (response.body === null) return ""
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener("abort", cancel, { once: true })
  try {
    const chunks: Array<Uint8Array> = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (signal.aborted) throw new Error("aborted")
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) throw new Error("body too large")
      chunks.push(value)
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
  } finally {
    signal.removeEventListener("abort", cancel)
    cancel()
  }
}

/**
 * One request to a provider. A redirect, a timeout, an oversized body or any
 * transport error is `unavailable`, and nothing of the cause travels on: the
 * error of a failed `fetch` can quote the request headers, the API key among them.
 */
export const send = (options: ProviderHttpOptions, url: string, init: RequestInit): Effect.Effect<ProviderReply, ProviderFailure> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await options.transport(url, { ...init, redirect: "manual", signal })
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel().catch(() => {})
        throw new Error("redirect")
      }
      return { status: response.status, headers: response.headers, text: await readBounded(response, signal) }
    },
    catch: unavailable,
  }).pipe(Effect.timeoutFail({ duration: options.timeoutMs ?? TIMEOUT_MS, onTimeout: unavailable }))

/** The fields the mapping reads, decoded strictly; anything else in the answer is ignored. */
export const decoded = <A, I>(schema: Schema.Schema<A, I>, text: string): Effect.Effect<A, ProviderFailure> =>
  Effect.try({ try: () => JSON.parse(text) as unknown, catch: unavailable }).pipe(
    Effect.flatMap((json) => ParseResult.decodeUnknown(schema)(json)),
    Effect.mapError(unavailable),
  )

/** A provider's wait hint, in whole seconds, held to 1..30. */
export const retryAfter = (value: unknown): number | undefined => {
  const seconds = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN
  return Number.isFinite(seconds) ? Math.min(30, Math.max(1, Math.ceil(seconds))) : undefined
}
