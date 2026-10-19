import { Data, Effect } from "effect"

/** `fetch` in production; a fake in the tests, which never reach a real provider. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>

/**
 * Why a call to a provider has no usable answer, and nothing more: the cause is
 * dropped on purpose, because the error of a failed `fetch` can quote the
 * request headers, a key or a token among them.
 *
 * - `not_sent`: the request provably never left (name resolution, a refused or
 *   unreachable connection, a failed TLS handshake). Safe to send again.
 * - `ambiguous`: it may have reached the provider (timeout, broken connection,
 *   redirect, oversized or undecodable body). Only an idempotent call may be repeated.
 */
export type SendFailureReason = "not_sent" | "ambiguous"

export class SendFailure extends Data.TaggedError("SendFailure")<{ readonly reason: SendFailureReason }> {}

interface Decoded {
  readonly utf8: string
  readonly bytes: Uint8Array
}

export type BodyDecoding = keyof Decoded

export interface SendOptions<D extends BodyDecoding> {
  readonly transport: Transport
  /** The whole exchange, body included. */
  readonly timeoutMs: number
  readonly maxBodyBytes: number
  /** `utf8` is strict: an invalid byte sequence fails the call instead of turning into U+FFFD. */
  readonly decode: D
}

export interface SendReply<D extends BodyDecoding> {
  readonly status: number
  readonly headers: Headers
  readonly body: Decoded[D]
}

const NOT_SENT_CODES = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT",
])

/** Whether a transport error, or one of its causes, is a connection that never opened. */
const neverSent = (error: unknown): boolean => {
  let current: unknown = error
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const { code, cause } = current as { readonly code?: unknown; readonly cause?: unknown }
    if (typeof code === "string" && NOT_SENT_CODES.has(code)) return true
    current = cause
  }
  return false
}

const ambiguous = (): SendFailure => new SendFailure({ reason: "ambiguous" })

const readBounded = async (response: Response, signal: AbortSignal, maxBytes: number): Promise<Buffer> => {
  if (Number(response.headers.get("content-length") ?? "0") > maxBytes) throw ambiguous()
  if (response.body === null) return Buffer.alloc(0)
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener("abort", cancel, { once: true })
  try {
    const chunks: Array<Uint8Array> = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (signal.aborted) throw ambiguous()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw ambiguous()
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally {
    signal.removeEventListener("abort", cancel)
    cancel()
  }
}

const decoders: { readonly [D in BodyDecoding]: (bytes: Buffer) => Decoded[D] } = {
  utf8: (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  bytes: (bytes) => bytes,
}

/**
 * One request, read incrementally up to `maxBodyBytes`, never following a
 * redirect. Any status is an answer for the caller to judge; only the
 * exchange itself fails here, as `not_sent` or `ambiguous`.
 */
export const send = <D extends BodyDecoding>(options: SendOptions<D>, url: string, init: RequestInit): Effect.Effect<SendReply<D>, SendFailure> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await options.transport(url, { ...init, redirect: "manual", signal })
        .catch((error: unknown) => { throw new SendFailure({ reason: neverSent(error) ? "not_sent" : "ambiguous" }) })
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel().catch(() => {})
        throw ambiguous()
      }
      const bytes = await readBounded(response, signal, options.maxBodyBytes)
      const decode: (raw: Buffer) => Decoded[D] = decoders[options.decode]
      return { status: response.status, headers: response.headers, body: decode(bytes) }
    },
    catch: (error) => error instanceof SendFailure ? error : ambiguous(),
  }).pipe(Effect.timeoutFail({ duration: options.timeoutMs, onTimeout: ambiguous }))
