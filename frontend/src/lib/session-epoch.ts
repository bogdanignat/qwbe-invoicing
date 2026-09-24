/**
 * Which session a request belongs to, told apart from which operation cancelled it.
 *
 * The controller already counts operation generations to abort superseded
 * restore/login/logout work, and that count moves whenever an operation merely
 * starts — including a logout the server refuses, which leaves the very same
 * session in place. Attributing a `401` to that count would discard a genuine
 * one as "stale" after such a refusal, so the number handed to the transport is
 * this one instead: it moves only where a session really begins or ends.
 *
 * Between an end and the next beginning the session is closed, and a `401` then
 * describes nothing left to close — a view still mounted may refetch, be
 * refused again and report it, and answering that with another cache wipe and
 * another redirect would repeat for as long as the navigation takes to commit.
 *
 * A freshly created epoch is in exactly that state: no session has opened yet,
 * so the first `open()` is what a `401` can refer back to and everything before
 * it owns nothing. Without that, a refusal arriving while the restore is still
 * checking — or while a failed login leaves the screen locked — would be read as
 * the end of a session that never began, wiping the cache and redirecting on top
 * of the work in flight. It also keeps the single mount of production behaving
 * like the mount/dispose/remount StrictMode performs in development, where the
 * intervening `dispose()` closes the epoch anyway.
 */
export interface SessionEpoch {
  /** The epoch a request leaving now belongs to. */
  readonly value: () => number
  /** Whether a `401` reported for `epoch` still describes the session in place. */
  readonly owns: (epoch: number) => boolean
  /** A session was established. */
  readonly open: () => void
  /** The session ended; nothing is authenticated until the next one opens. */
  readonly close: () => void
}

export const createSessionEpoch = (): SessionEpoch => {
  let value = 0
  let closed = true
  const advance = (next: boolean): void => { value += 1; closed = next }
  return {
    value: () => value,
    owns: (epoch) => !closed && epoch === value,
    open: () => { advance(false) },
    close: () => { advance(true) },
  }
}
