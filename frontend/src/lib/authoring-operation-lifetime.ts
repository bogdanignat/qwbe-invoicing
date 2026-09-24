/**
 * The two lifetimes an authoring screen's operations live under, kept outside
 * React so a controller can read them when an operation runs instead of when it
 * is built.
 *
 * They are deliberately independent, because they end at different moments:
 *
 * - the *mount* axis (`isAlive`) says whether the screen that started an
 *   operation is still on the page, and decides whether an answer may still
 *   reach state or the cache. It survives a session change: whether a new
 *   session may act on an old answer is decided by the epoch ownership checks
 *   in the controllers, not by tearing this down.
 * - the *requests* axis (`signal`) is a session boundary: a reconciliation read
 *   started under one session must not outlive it, so every session gets its
 *   own `AbortController` and the old one is aborted when the session ends.
 *
 * Generations make cleanup exact: `endRequests` aborts only the generation it
 * was handed, so the cleanup of an old session can never abort the requests of
 * the session that replaced it — the case StrictMode's mount/unmount/mount
 * rehearsal produces on every development render.
 *
 * The state lives in the closure and the returned methods are readonly: an
 * instance can be held for a whole mount without any mutable field being read
 * during render.
 */
export interface OperationLifetime {
  /** Whether the screen that owns this lifetime is still mounted. */
  readonly isAlive: () => boolean
  /** Mount setup. Idempotent: re-activating an already active lifetime changes nothing. */
  readonly activate: () => void
  /** Mount cleanup: nothing may reach React any more, and requests in flight are abandoned. */
  readonly deactivate: () => void
  /** Session setup: a fresh signal, and the generation that owns it. */
  readonly beginRequests: () => number
  /** Session cleanup: aborts that generation's requests, and only if it is still the current one. */
  readonly endRequests: (generation: number) => void
  /** The signal of the current generation, read when a request is sent. */
  readonly signal: () => AbortSignal
}

/**
 * A lifetime starts alive with a usable signal, so an operation that runs
 * before the effects of the first commit have fired behaves exactly as it did
 * when these two axes were a `useRef(true)` and a `useRef(new AbortController())`.
 *
 * The factory itself is pure — it only builds its own state — so the double
 * invocation of a `useState` initialiser under StrictMode is harmless.
 */
export const createOperationLifetime = (): OperationLifetime => {
  let aliveNow = true
  let generation = 0
  let controller = new AbortController()
  const isAlive = (): boolean => aliveNow
  const activate = (): void => { aliveNow = true }
  const deactivate = (): void => {
    aliveNow = false
    controller.abort()
  }
  const beginRequests = (): number => {
    generation += 1
    controller = new AbortController()
    return generation
  }
  const endRequests = (owned: number): void => {
    if (owned !== generation) return
    controller.abort()
  }
  const signal = (): AbortSignal => controller.signal
  return { isAlive, activate, deactivate, beginRequests, endRequests, signal }
}
