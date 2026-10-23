import type { ListedMessage } from "../../submissions/index.ts"

const DAY_MS = 86_400_000

/** ANAF refuses a `startTime` older than 60 days before the moment of the request (`docs/EFACTURA.md`, ANAF TEST 2026-10-23). */
export const LISTABLE_DAYS = 60
/** A fetch is listed a little after it is made: its start stays this far inside the 60 days. */
export const START_MARGIN_MS = 15 * 60_000
/** A fetch starts one day before the coverage, so a message ANAF lists late around the edge is not missed. */
export const OVERLAP_MS = DAY_MS
/** A message whose download failed this many times is given up by its fetch. */
export const MAX_DOWNLOAD_ATTEMPTS = 3
/** A failed download is tried again this long after. */
export const DOWNLOAD_RETRY_MS = 5 * 60_000
/** A list call that ANAF answered unclearly, or never, is repeated this many times before the fetch fails. */
export const MAX_LIST_RETRIES = 5

/** The only message type a fetch keeps: `filtru=P` answers nothing else on ANAF TEST. */
export const RECEIVED_TYPE = "FACTURA PRIMITA"

/** Why a fetch failed, besides ANAF's own error texts. */
export const FETCH_FAILURES = {
  notConnected: "neconectat",
  otherCif: "conexiune_alt_cif",
  noRight: "fara_drept_cif",
  tokenRefused: "token_refuzat",
  windowExpired: "fereastra_expirata",
  anafUnavailable: "anaf_indisponibil",
} as const

export interface FetchWindow {
  /** ISO instants. */
  readonly start: string
  readonly end: string
  /** Between the coverage and `start`: what this list can no longer reach. Absent when there is no such gap. */
  readonly gap?: { readonly from: string; readonly until: string }
}

const iso = (time: number): string => new Date(time).toISOString()

/** The earliest `startTime` ANAF still lists at `at`, with the margin. */
export const listableFrom = (at: Date): number => at.getTime() - LISTABLE_DAYS * DAY_MS + START_MARGIN_MS

/** Whether ANAF still lists a window that starts at `start`: past that, the fetch fails instead of asking. */
export const listable = (start: string, at: Date): boolean => Date.parse(start) >= at.getTime() - LISTABLE_DAYS * DAY_MS

/**
 * The window of a new fetch: up to now, from one day before the coverage, but
 * never before what ANAF still lists. Without a coverage, all it still lists.
 * A coverage older than that leaves a gap the window says out loud.
 */
export const fetchWindow = (now: Date, coveredUntil: string | undefined): FetchWindow => {
  const floor = listableFrom(now)
  const start = coveredUntil === undefined ? floor : Math.max(floor, Date.parse(coveredUntil) - OVERLAP_MS)
  const window = { start: iso(start), end: now.toISOString() }
  return coveredUntil !== undefined && Date.parse(coveredUntil) < start ? { ...window, gap: { from: coveredUntil, until: window.start } } : window
}

export const isReceivedInvoice = (message: ListedMessage): boolean => message.type.trim().toUpperCase() === RECEIVED_TYPE

/** After one more failed download: whether its fetch still tries it. */
export const retriable = (attempts: number): boolean => attempts < MAX_DOWNLOAD_ATTEMPTS

/**
 * The coverage rule. A completed fetch moves the coverage to its window's end
 * only when none of its messages was given up: one that exhausted its attempts
 * holds the coverage where it was, so the next fetch lists the same days again,
 * finds the message still not stored, and tries it anew.
 */
export const advancesCoverage = (givenUp: number): boolean => givenUp === 0
