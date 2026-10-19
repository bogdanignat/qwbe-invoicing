import { retryAfterSeconds } from "./budgets.ts"

/**
 * An HTTP answer from ANAF as the host hands it over: the status, the raw
 * `Retry-After` and the body, already bounded in size. Transport failures never
 * get here; the host records them as `not_sent` or `ambiguous`.
 */
export interface AnafReply<Body = string> {
  readonly status: number
  readonly retryAfter: string | null
  readonly body: Body
}

/** How one call ended, as `efactura_submission_attempts.outcome` stores it. */
export const CALL_OUTCOMES = ["answered", "anaf_error", "auth_refused", "rate_limited", "unrecognized", "not_sent", "ambiguous"] as const
export type CallOutcome = (typeof CALL_OUTCOMES)[number]

/** ANAF refused the request itself before looking at it: a token to refresh, or a pause to take. */
export type Interrupted =
  | { readonly kind: "auth_refused" }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number }

export const interrupted = (reply: AnafReply<unknown>): Interrupted | undefined => {
  if (reply.status === 401 || reply.status === 403) return { kind: "auth_refused" }
  if (reply.status === 429) return { kind: "rate_limited", retryAfterSeconds: retryAfterSeconds(reply.retryAfter) }
  return undefined
}

export const UNRECOGNIZED = { kind: "unrecognized" } as const

const MAX_MESSAGES = 20
const MAX_MESSAGE_CHARS = 500

const printable = (text: string): string => Array.from(text, (character) => {
  const code = character.codePointAt(0) ?? 0
  return code < 0x20 || code === 0x7f ? " " : character
}).join("").replace(/\s+/gu, " ").trim()

/**
 * ANAF's own error texts, kept for the user: strings only, control characters
 * folded to spaces, each cut to 500 characters and at most 20 of them.
 */
export const sanitizedMessages = (messages: ReadonlyArray<unknown>): ReadonlyArray<string> => messages
  .filter((message): message is string => typeof message === "string")
  .map((message) => printable(message).slice(0, MAX_MESSAGE_CHARS))
  .filter((message) => message.length > 0)
  .slice(0, MAX_MESSAGES)

/** ANAF's identifiers (upload index, download id, message id) are decimal digits. */
export const anafId = (value: unknown): string | undefined =>
  typeof value === "string" && /^[0-9]{1,20}$/u.test(value) ? value : undefined
