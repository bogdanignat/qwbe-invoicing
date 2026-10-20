import type { AnafReply, CallOutcome, ListedMessage, ListResult } from "../../submissions/index.ts"

const DAY_MS = 86_400_000

/** ANAF lists at most 60 days at once. */
export const MAX_WINDOW_DAYS = 60

/** A link looks at most this many pages of the window for the index; past them it refuses. */
export const MAX_LINK_PAGES = 10

export interface ListWindow {
  /** Epoch milliseconds. */
  readonly startTime: number
  readonly endTime: number
}

/**
 * Where an `unknown` submission's upload can be: from the moment it was
 * created, for at most 60 days, and never past now.
 */
export const listWindow = (createdAt: string, now: Date): ListWindow => {
  const startTime = Date.parse(createdAt)
  const endTime = Math.min(now.getTime(), startTime + MAX_WINDOW_DAYS * DAY_MS)
  return { startTime, endTime: Math.max(startTime, endTime) }
}

/**
 * The message types an upload of this CIF leaves in its list: the invoice it
 * sent, or the errors ANAF found in it. A received invoice, or a buyer's
 * message, carries someone else's upload index and is never a candidate.
 * The spelling is ANAF's documented one, confirmed on ANAF TEST in task 6.
 */
export const OWN_UPLOAD_TYPES: ReadonlyArray<string> = ["FACTURA TRIMISA", "ERORI FACTURA"]

export const isOwnUpload = (message: ListedMessage): boolean => OWN_UPLOAD_TYPES.includes(message.type.trim().toUpperCase())

/** How the call ends up in `efactura_submission_attempts`: the transport's failure, ANAF's refusal, or what the answer was. */
export const listOutcome = (reply: AnafReply | "not_sent" | "ambiguous", result: ListResult): CallOutcome => {
  if (typeof reply === "string") return reply
  if (result.kind === "messages") return "answered"
  if (result.kind === "no_right") return "anaf_error"
  return result.kind
}
