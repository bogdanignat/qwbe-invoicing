import type { PoolClient } from "pg"

/**
 * The maintenance barrier: one advisory lock, two modes.
 *
 * `migrate`, `backup` and `restore` take it EXCLUSIVE; the running application
 * holds it SHARED for the life of its process, so a maintenance command cannot
 * start while writers are live and writers cannot start while it runs.
 *
 * Two rules the callers have to honour, both of them deadlock-shaped:
 *
 * 1. A caller that already holds the lock on a client must not re-enter a
 *    helper that acquires it again on a DIFFERENT connection — that is a
 *    self-deadlock, not a re-entrant lock. Every function here takes the
 *    `PoolClient` it works on, and `applyMigrationsOnClient` exists precisely so
 *    the exclusive holder can run the migrations on the connection it owns.
 * 2. Session locks live on the connection, not on the transaction. The client
 *    must not go back to the pool while the lock is held, so acquire and
 *    release bracket the work on one checked-out client.
 *
 * Ownership: nothing here connects, releases or ends anything. The caller owns
 * the client it passes and is responsible for returning it to the pool.
 */

/**
 * Key of the barrier, as the two int4 arguments PostgreSQL takes. 1480 is the
 * ticket that introduced it; the second slot is free for a future second lock.
 */
export const maintenanceLockKey = { classId: 1480, objectId: 1 } as const

const keyValues = [maintenanceLockKey.classId, maintenanceLockKey.objectId]

/** Blocks until the exclusive barrier is held by this client's session. */
export const acquireMaintenanceLock = async (client: PoolClient): Promise<void> => {
  await client.query("SELECT pg_advisory_lock($1, $2)", keyValues)
}

/**
 * Takes the exclusive barrier if it is free, answers `false` without waiting if
 * it is not — the shape a maintenance command needs to refuse while the
 * application is up, instead of hanging behind it.
 */
export const tryAcquireMaintenanceLock = async (client: PoolClient): Promise<boolean> => {
  const { rows } = await client.query<{ readonly locked: boolean }>(
    "SELECT pg_try_advisory_lock($1, $2) AS locked",
    keyValues,
  )
  return rows[0]?.locked === true
}

/** Blocks until the shared barrier is held: the mode the running application takes. */
export const acquireSharedMaintenanceLock = async (client: PoolClient): Promise<void> => {
  await client.query("SELECT pg_advisory_lock_shared($1, $2)", keyValues)
}

/** Releases one exclusive hold. Answers `false` when this session held none. */
export const releaseMaintenanceLock = async (client: PoolClient): Promise<boolean> => {
  const { rows } = await client.query<{ readonly released: boolean }>(
    "SELECT pg_advisory_unlock($1, $2) AS released",
    keyValues,
  )
  return rows[0]?.released === true
}

/** Releases one shared hold. Answers `false` when this session held none. */
export const releaseSharedMaintenanceLock = async (client: PoolClient): Promise<boolean> => {
  const { rows } = await client.query<{ readonly released: boolean }>(
    "SELECT pg_advisory_unlock_shared($1, $2) AS released",
    keyValues,
  )
  return rows[0]?.released === true
}
