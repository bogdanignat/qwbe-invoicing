import type { OperationLifetime } from "./authoring-operation-lifetime.ts"

/**
 * The two effect bodies every authoring screen runs, written once and tested
 * without a DOM.
 *
 * They used to be copied inline into three hooks, which meant the one thing
 * worth proving — that the mount axis and the session axis are wired to the
 * right lifetime, in the right order, each cleaning up its own generation —
 * could only be read, never executed. Each helper does the setup and returns
 * the cleanup, so a hook is `useEffect(() => wiring(lifetime), [deps])`: the
 * dependency list stays visible to the linter and the body stays pure enough to
 * call from a test that just plays mount, cleanup and mount again.
 */

/** Mount setup and its cleanup: after the cleanup, no answer may reach React. */
export const lifetimeMountEffect = (lifetime: OperationLifetime): (() => void) => {
  lifetime.activate()
  return () => { lifetime.deactivate() }
}

/**
 * Session setup and its cleanup. The generation is captured at setup, so the
 * cleanup of a session that has already been replaced aborts nothing: under
 * StrictMode's mount/unmount/mount rehearsal the second setup has already
 * installed a fresh signal by the time the first cleanup runs.
 */
export const lifetimeRequestsEffect = (lifetime: OperationLifetime): (() => void) => {
  const generation = lifetime.beginRequests()
  return () => { lifetime.endRequests(generation) }
}
