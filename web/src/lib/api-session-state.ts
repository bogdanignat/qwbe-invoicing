import { Effect, Ref } from "effect"

export const csrfTokenRef = Effect.runSync(Ref.make<string | undefined>(undefined))
export const unauthorizedListeners = new Set<() => void>()
export const clearApiSession = Ref.set(csrfTokenRef, undefined)
export const onUnauthorized = (listener: () => void): (() => void) => {
  unauthorizedListeners.add(listener)
  return () => { unauthorizedListeners.delete(listener) }
}
