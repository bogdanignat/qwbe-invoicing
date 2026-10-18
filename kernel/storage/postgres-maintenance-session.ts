import type { Pool, PoolClient } from "pg"

import { maintenanceLockKey, releaseSharedMaintenanceLock } from "./postgres-maintenance-lock.ts"

/**
 * The application's lifetime hold on the maintenance barrier, and its recovery.
 *
 * The running process holds the barrier SHARED on one dedicated connection for
 * as long as it serves traffic, so `migrate`, `backup` and `restore` — which
 * want it EXCLUSIVE — refuse while writers are live. The connection comes from
 * the maintenance pool (`max: 1`, no idle reaping): a session lock lives on its
 * connection, and a reaped client would drop the barrier silently.
 *
 * Three properties, each of them load-bearing:
 *
 * 1. **Starting never fails.** `start` neither rejects nor blocks on the
 *    database: with the server down it answers a session whose `held()` is
 *    `false` and keeps trying in the background, so HTTP comes up and
 *    `/health/live` answers 200 while `/health/ready` and `/api*` answer 503.
 * 2. **Losing the barrier is not terminal.** A dropped connection, a
 *    `pg_terminate_backend`, a restart or `pg_advisory_unlock_all` flips
 *    `held()` to `false` at once, destroys the client so the `max: 1` pool keeps
 *    its slot, and re-acquires with bounded backoff: the gate reopens by itself.
 * 3. **One probe at a time.** The keepalive asks `pg_locks` whether THIS backend
 *    still holds the lock — evidence, not assumption — and joins the pending
 *    chain instead of piling probes onto the one connection that must answer.
 */

export interface MaintenanceSessionOptions {
  /** Backoff between re-acquire attempts: first delay, and the cap it grows to. */
  readonly retryDelayMillis?: number
  readonly maxRetryDelayMillis?: number
  /** How often the hold is re-verified. */
  readonly keepaliveMillis?: number
  readonly onLost?: (reason: string) => void
  readonly onAcquired?: () => void
}

export interface MaintenanceSession {
  /** Whether the barrier is held right now. Readiness reads this. */
  readonly held: () => boolean
  /** Why it is not held, for a safe diagnostic. Never carries a driver message. */
  readonly state: () => "held" | "acquiring" | "released"
  /** Idempotent: stops the worker, awaits what is in flight, releases the hold. */
  readonly release: () => Promise<void>
}

const defaults = { retryDelayMillis: 250, maxRetryDelayMillis: 5_000, keepaliveMillis: 5_000 } as const

const keyValues = [maintenanceLockKey.classId, maintenanceLockKey.objectId]

const tryShared = async (client: PoolClient): Promise<boolean> => {
  const { rows } = await client.query<{ readonly locked: boolean }>(
    "SELECT pg_try_advisory_lock_shared($1, $2) AS locked",
    keyValues,
  )
  return rows[0]?.locked === true
}

const stillHeld = async (client: PoolClient): Promise<boolean> => {
  const { rows } = await client.query<{ readonly present: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = $1"
    + " AND objid = $2 AND pid = pg_backend_pid() AND granted) AS present",
    keyValues,
  )
  return rows[0]?.present === true
}

export const startMaintenanceSession = async (
  pool: Pool,
  options: MaintenanceSessionOptions = {},
): Promise<MaintenanceSession> => {
  const first = options.retryDelayMillis ?? defaults.retryDelayMillis
  const cap = options.maxRetryDelayMillis ?? defaults.maxRetryDelayMillis
  const keepaliveMillis = options.keepaliveMillis ?? defaults.keepaliveMillis

  // One mutable record rather than four `let`s: the worker and the returned
  // session read it from different turns of the event loop, and a plain `let`
  // would be narrowed by the compiler to the value it had at the last
  // assignment it can see.
  const state = { client: undefined as PoolClient | undefined, holding: false, stopped: false }
  /** Read through a function: a direct property read is narrowed by the compiler. */
  const isStopped = (): boolean => state.stopped
  let pending: Promise<void> = Promise.resolve()
  let timer: NodeJS.Timeout | undefined

  /** Gives the connection back as unusable: a lost barrier means unknown state. */
  const discard = (reason: string): void => {
    const current = state.client
    state.client = undefined
    state.holding = false
    // Destroyed, not returned: its listeners go with it.
    current?.release(new Error(reason))
  }

  const lose = (reason: string): void => {
    if (!state.holding && state.client === undefined) return
    discard(reason)
    options.onLost?.(reason)
    schedule(first)
  }

  const attempt = async (): Promise<boolean> => {
    if (isStopped()) return false
    let candidate: PoolClient | undefined
    let onClientError: ((error: unknown) => void) | undefined
    try {
      candidate = await pool.connect()
      // An idle client dropped by the server emits `error`; without a listener
      // Node ends the process, and the barrier would be lost unnoticed. The
      // handler is named and removed again on every path that gives the client
      // back unused: the pool is `max: 1`, so it hands out the SAME client
      // instance each retry, and an attached-and-forgotten listener would pile
      // up one per attempt while a backup holds the barrier exclusively.
      onClientError = () => { lose("the maintenance connection failed") }
      candidate.on("error", onClientError)
      if (!await tryShared(candidate)) {
        candidate.off("error", onClientError)
        onClientError = undefined
        candidate.release()
        return false
      }
      if (isStopped()) {
        await releaseSharedMaintenanceLock(candidate).catch(() => undefined)
        candidate.off("error", onClientError)
        onClientError = undefined
        candidate.release()
        return false
      }
      state.client = candidate
      state.holding = true
      options.onAcquired?.()
      return true
    } catch {
      // Never rethrown: the caller's boot must not depend on the database.
      if (candidate !== undefined && onClientError !== undefined) candidate.off("error", onClientError)
      candidate?.release(new Error("the maintenance barrier could not be taken"))
      return false
    }
  }

  function schedule(delay: number): void {
    if (isStopped() || timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      pending = pending.then(async () => {
        if (isStopped() || state.holding) return
        if (!await attempt()) schedule(Math.min(delay * 2, cap))
      })
    }, delay)
    timer.unref()
  }

  const verify = (): void => {
    const current = state.client
    if (isStopped() || !state.holding || current === undefined) return
    // Single-flight: the next tick joins the chain instead of starting a probe
    // of its own.
    pending = pending.then(async () => {
      if (isStopped() || !state.holding || state.client !== current) return
      try {
        if (!await stillHeld(current)) lose("the maintenance barrier is no longer held by this session")
      } catch {
        lose("the maintenance barrier could not be verified")
      }
    })
  }

  if (!await attempt()) {
    options.onLost?.("the maintenance barrier is not held; serving unready and retrying")
    schedule(first)
  }

  const keepalive = setInterval(verify, keepaliveMillis)
  keepalive.unref()

  let releasing: Promise<void> | undefined
  return {
    held: () => state.holding,
    state: () => isStopped() ? "released" : state.holding ? "held" : "acquiring",
    release: () => releasing ??= (async () => {
      state.stopped = true
      clearInterval(keepalive)
      if (timer !== undefined) { clearTimeout(timer); timer = undefined }
      // Whatever the worker had in flight finishes before the connection is
      // touched, so nothing queries a client that is already back in the pool.
      await pending.catch(() => undefined)
      const current = state.client
      state.client = undefined
      state.holding = false
      if (current === undefined) return
      try {
        await releaseSharedMaintenanceLock(current)
        current.removeAllListeners("error")
        current.release()
      } catch {
        // Already gone, which released the lock with it.
        current.release(new Error("the maintenance barrier could not be released"))
      }
    })(),
  }
}
