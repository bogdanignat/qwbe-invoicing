/**
 * A counter that tells an answer whether the state it was asked about is still
 * the state in front of the user.
 *
 * It exists because a save is not instantaneous: the payload leaves, the user
 * keeps typing, and the answer comes back describing a document that is no
 * longer what the form holds. Resetting the form from that answer would silently
 * discard the edits made while it was in flight. The revision is read *before*
 * the request and compared *after* it: equal means nothing was touched and the
 * server's version may replace the form, different means the screen must say so
 * instead of overwriting.
 *
 * `begin` is for a selection that supersedes the previous one (choosing a second
 * file while the first is still being validated); `invalidate` is for an edit
 * that only has to make older answers stale.
 */
export interface RevisionGuard {
  readonly begin: () => number
  readonly invalidate: () => void
  readonly current: () => number
  readonly isCurrent: (revision: number) => boolean
}

export const createRevisionGuard = (): RevisionGuard => {
  let current = 0
  return {
    begin: () => { current += 1; return current },
    invalidate: () => { current += 1 },
    current: () => current,
    isCurrent: (revision) => revision === current,
  }
}
