/**
 * When to ask `stareMesaj` again: 1, 2, 5, 10 and 30 minutes after the
 * previous look, then every hour. `pollsDone` is how many times this upload's
 * status was already asked; right after the upload it is 0.
 */
export const POLL_DELAYS_MINUTES: ReadonlyArray<number> = [1, 2, 5, 10, 30]
export const LATER_POLL_MINUTES = 60

export const pollDelayMinutes = (pollsDone: number): number => POLL_DELAYS_MINUTES[pollsDone] ?? LATER_POLL_MINUTES

export const nextPollAt = (at: Date, pollsDone: number): Date => new Date(at.getTime() + pollDelayMinutes(pollsDone) * 60_000)
