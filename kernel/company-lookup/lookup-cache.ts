import { Deferred, Effect, FiberId } from "effect"

import type { ProviderFailure } from "../../cubes/invoicing/company-lookup/index.ts"

export const TTL_MS = 24 * 60 * 60 * 1000
export const CAPACITY = 500

export interface LookupCacheOptions {
  readonly now?: () => number
  readonly ttlMs?: number
  readonly capacity?: number
}

export interface LookupCache {
  /** The remembered answer for `key`, or `load`'s; identical questions in flight share one `load`. */
  readonly get: <A>(key: string, load: Effect.Effect<A, ProviderFailure>) => Effect.Effect<A, ProviderFailure>
}

/**
 * Answers in memory, per process: 24 hours, the 500 most recently used.
 * Only answers are kept, "not found" included; a failure is never remembered,
 * so the next question asks again. The load runs detached: a caller that goes
 * away does not cancel it for the others waiting on it, and the provider's own
 * timeout bounds it. Values are stored untyped; every key names its operation,
 * so a key always comes back with the type it was stored with.
 */
export const createLookupCache = (options: LookupCacheOptions = {}): LookupCache => {
  const now = options.now ?? Date.now
  const ttl = options.ttlMs ?? TTL_MS
  const capacity = options.capacity ?? CAPACITY
  const answers = new Map<string, { readonly expiresAt: number; readonly value: unknown }>()
  const inFlight = new Map<string, Deferred.Deferred<unknown, ProviderFailure>>()

  const remember = (key: string, value: unknown) => Effect.sync(() => {
    answers.delete(key)
    answers.set(key, { expiresAt: now() + ttl, value })
    for (const oldest of answers.keys()) {
      if (answers.size <= capacity) break
      answers.delete(oldest)
    }
  })

  const start = (key: string, load: Effect.Effect<unknown, ProviderFailure>) => {
    const deferred = Deferred.unsafeMake<unknown, ProviderFailure>(FiberId.none)
    inFlight.set(key, deferred)
    const run = load.pipe(Effect.tap((value) => remember(key, value)), Effect.exit,
      Effect.flatMap((exit) => Effect.sync(() => inFlight.delete(key)).pipe(Effect.zipRight(Deferred.done(deferred, exit)))))
    return Effect.forkDaemon(run).pipe(Effect.zipRight(Deferred.await(deferred)))
  }

  return {
    get: <A>(key: string, load: Effect.Effect<A, ProviderFailure>) => Effect.suspend(() => {
      const hit = answers.get(key)
      if (hit !== undefined && hit.expiresAt > now()) {
        answers.delete(key)
        answers.set(key, hit)
        return Effect.succeed(hit.value as A)
      }
      answers.delete(key)
      const pending = inFlight.get(key)
      return (pending === undefined ? start(key, load) : Deferred.await(pending)) as Effect.Effect<A, ProviderFailure>
    }),
  }
}
