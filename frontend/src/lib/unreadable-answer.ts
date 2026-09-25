import { ApiFailure } from "./api-errors.ts"

/**
 * A write whose answer reached this client but could not be read.
 *
 * Two doors lead here and both mean the same thing: the request left, the
 * server may well have committed it, and nothing local can say which. A `2xx`
 * whose body is not JSON (a proxy's HTML error page, say) arrives as an
 * `ApiFailure` carrying a *success* status, and a `2xx` whose JSON drifted from
 * the contract arrives as a plain decoder `Error`. Classified as ordinary
 * failures they would look settled, and the next click would send the write
 * again — a second draft, a second invoice.
 *
 * Only writes are wrapped. A read that cannot be decoded tells us nothing
 * happened on the server, so it stays the honest error it is.
 */
export class UnreadableAnswer extends Error {
  override readonly cause: unknown

  constructor(cause: unknown) {
    super("Serverul a răspuns, dar răspunsul nu a putut fi citit: operația poate să fi fost înregistrată. Nu retrimite documentul înainte de a verifica registrul.")
    this.name = "UnreadableAnswer"
    this.cause = cause
  }
}

/**
 * Whether a rejection from a write means "the answer arrived unreadable"
 * rather than "the request failed".
 *
 * An abort is the caller's own doing and keeps its identity. An `ApiFailure`
 * that carries a failing status — or none at all, which is a transport failure
 * — is already classified: `isLostResponse` decides what those mean and this
 * must not overwrite them. What is left is exactly the ambiguous pair: a
 * success status whose body could not be parsed, and a non-`ApiFailure` error,
 * which inside a write can only come from the decoder that ran on the answer.
 */
const unreadable = (error: unknown): boolean => {
  if (error instanceof Error && error.name === "AbortError") return false
  if (error instanceof UnreadableAnswer) return false
  if (!(error instanceof ApiFailure)) return true
  return error.status !== undefined && error.status < 400
}

/** Wraps one write — the request and the decoding of its answer, nothing else. */
export const readableWrite = <T>(answer: Promise<T>): Promise<T> =>
  answer.catch((error: unknown) => {
    if (error instanceof UnreadableAnswer) throw error
    if (!unreadable(error)) throw error
    throw new UnreadableAnswer(error)
  })
