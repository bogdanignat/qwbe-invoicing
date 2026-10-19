/**
 * ANAF's call limits, held below the published ones (100 `stareMesaj` and 10
 * `descarcare` per message per day, 1000 calls per minute) so a clock skew or
 * a call that timed out after reaching ANAF never tips an organization over.
 * A call is reserved before it is made, timed-out ones included; the host
 * stores the result of each reservation in the same transaction that grants it.
 */
export const MESSAGE_CALLS_PER_DAY = { stareMesaj: 90, descarcare: 9 } as const
export type BudgetedOperation = keyof typeof MESSAGE_CALLS_PER_DAY
export const ORGANIZATION_CALLS_PER_MINUTE = 900
export const MAX_RETRY_AFTER_SECONDS = 30
/** `paused_until` of an organization that was never paused. */
export const NEVER_PAUSED = "1970-01-01T00:00:00.000Z"

const bucharestDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" })

/** The calendar day in Bucharest, `YYYY-MM-DD`: the daily counters reset at its midnight. */
export const bucharestDay = (at: Date): string => bucharestDate.format(at)

const HOUR_MS = 3_600_000

/**
 * The first instant of the next Bucharest day. Romania changes its clocks at
 * 03:00/04:00, never at midnight, so midnight is UTC+2 or UTC+3 and one of the
 * two candidates is it.
 */
export const nextBucharestMidnight = (at: Date): Date => {
  const [year, month, day] = bucharestDay(at).split("-").map(Number)
  const nextDay = Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1)
  const tomorrow = bucharestDay(new Date(nextDay))
  const midnight = [3, 2].map((offset) => new Date(nextDay - offset * HOUR_MS))
    .find((candidate) => bucharestDay(candidate) === tomorrow && bucharestDay(new Date(candidate.getTime() - 1)) !== tomorrow)
  if (midnight === undefined) throw new Error("Europe/Bucharest midnight is neither UTC+2 nor UTC+3")
  return midnight
}

export interface MessageBudget {
  readonly day: string
  readonly used: number
}

/** The counter after one more call on this message today, or `undefined` when today's budget is spent. */
export const reserveMessageCall = (operation: BudgetedOperation, current: MessageBudget | undefined, at: Date): MessageBudget | undefined => {
  const day = bucharestDay(at)
  const used = current?.day === day ? current.used : 0
  return used < MESSAGE_CALLS_PER_DAY[operation] ? { day, used: used + 1 } : undefined
}

export interface OrganizationBudget {
  /** The UTC minute the counter belongs to, `YYYY-MM-DDTHH:MM`. */
  readonly minute: string
  readonly used: number
  readonly pausedUntil: string
}

export type OrganizationReservation =
  | { readonly granted: OrganizationBudget }
  | { readonly waitUntil: string }

const minuteOf = (at: Date): string => at.toISOString().slice(0, 16)

/** One more call for the organization this minute, unless a 429 pause or the minute's budget holds it back. */
export const reserveOrganizationCall = (current: OrganizationBudget | undefined, at: Date): OrganizationReservation => {
  const now = at.toISOString()
  const pausedUntil = current?.pausedUntil ?? NEVER_PAUSED
  if (pausedUntil > now) return { waitUntil: pausedUntil }
  const minute = minuteOf(at)
  const used = current?.minute === minute ? current.used : 0
  if (used >= ORGANIZATION_CALLS_PER_MINUTE) return { waitUntil: new Date(Date.parse(`${minute}:00.000Z`) + 60_000).toISOString() }
  return { granted: { minute, used: used + 1, pausedUntil } }
}

/**
 * ANAF's `Retry-After`, read only as whole seconds and held to 1..30. A date,
 * a fraction, a sign or nothing at all is not trusted: the pause is then the
 * longest one, 30 seconds.
 */
export const retryAfterSeconds = (header: string | null | undefined): number => {
  const value = header?.trim() ?? ""
  if (!/^[0-9]{1,9}$/u.test(value)) return MAX_RETRY_AFTER_SECONDS
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Number(value)))
}

/** After a 429 the whole organization pauses; an earlier, longer pause is never shortened. */
export const pauseAfterRateLimit = (current: OrganizationBudget | undefined, at: Date, header: string | null | undefined): OrganizationBudget => {
  const until = new Date(at.getTime() + retryAfterSeconds(header) * 1000).toISOString()
  const pausedUntil = current !== undefined && current.pausedUntil > until ? current.pausedUntil : until
  return { minute: current?.minute ?? minuteOf(at), used: current?.used ?? 0, pausedUntil }
}
