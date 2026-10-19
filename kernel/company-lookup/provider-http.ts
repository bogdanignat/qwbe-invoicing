import { Effect, ParseResult, type Schema } from "effect"

import { ProviderFailure } from "../../cubes/invoicing/company-lookup/index.ts"
import { send as sendRequest, type Transport } from "../outbound/send.ts"

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

/**
 * One request to a provider (`kernel/outbound/send.ts`, strict UTF-8). A
 * redirect, a timeout, an oversized body or any transport error is
 * `unavailable`: a lookup is only ever asked again by the user.
 */
export const send = (options: ProviderHttpOptions, url: string, init: RequestInit): Effect.Effect<ProviderReply, ProviderFailure> =>
  sendRequest({ transport: options.transport, timeoutMs: options.timeoutMs ?? TIMEOUT_MS, maxBodyBytes: MAX_BODY_BYTES, decode: "utf8" }, url, init).pipe(
    Effect.map(({ status, headers, body }) => ({ status, headers, text: body })),
    Effect.mapError(unavailable),
  )

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
