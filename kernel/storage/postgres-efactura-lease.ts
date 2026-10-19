import { Data, Effect } from "effect"
import type { Pool } from "pg"

import { efacturaSubmissionsLockKey } from "./postgres-efactura-submission-rows.ts"
import { maintenanceLockKey } from "./postgres-maintenance-lock.ts"
import { createMaintenancePool, type PostgresSettings } from "./postgres-pool.ts"
import { firstRow, integer } from "./postgres-rows.ts"
import { transactionWith, type AdvisoryLockKey, type TransactionClient } from "./postgres-transaction.ts"

/** The dispatcher's session lock: whoever holds it is the one executor. */
export const dispatcherLockKey: AdvisoryLockKey = { classId: maintenanceLockKey.classId, objectId: 8 }

/** The executor's right is gone (lock, epoch or connection) or one of its transactions failed: it stops at once. */
export class LeadershipLost extends Data.TaggedError("LeadershipLost")<{ readonly reason: string }> {}

const KEY = [dispatcherLockKey.classId, dispatcherLockKey.objectId]
const HOLDS_LOCK = "EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=$2 AND objid=$3 AND objsubid=2"
  + " AND pid=pg_backend_pid() AND granted)"
const FENCE = `SELECT 1 AS fenced FROM efactura_dispatcher_epoch WHERE singleton AND epoch=$1 AND ${HOLDS_LOCK}`
const BUMP = `INSERT INTO efactura_dispatcher_epoch(singleton,epoch,acquired_at) SELECT true,1,$1 WHERE ${HOLDS_LOCK}
  ON CONFLICT(singleton) DO UPDATE SET epoch=efactura_dispatcher_epoch.epoch+1,acquired_at=EXCLUDED.acquired_at RETURNING epoch`

export interface DispatcherLease {
  readonly epoch: number
  /** The dedicated connection: one client, never reaped, so the session lock stays on it. */
  readonly pool: Pool
  /**
   * One transaction under the submissions key that first proves, in itself,
   * that this connection still holds the lock and the epoch is still this one.
   * Any failure, the proof included, is `LeadershipLost`.
   */
  readonly run: <A>(use: (client: TransactionClient) => Promise<A>) => Effect.Effect<A, LeadershipLost>
  /** The same proof outside a transaction, for the keepalive. */
  readonly verify: () => Promise<boolean>
  /** Closes the connection, which releases the session lock with it. Idempotent. */
  readonly end: () => Promise<void>
}

const lost = (reason: string) => () => new LeadershipLost({ reason })

const fenced = async (client: TransactionClient, epoch: number) => {
  const { rows } = await client.query(FENCE, [epoch, ...KEY])
  if (firstRow(rows) === undefined) throw new LeadershipLost({ reason: "the dispatcher lock or epoch moved on" })
}

/**
 * Takes the lock if it is free and bumps the epoch in a transaction that checks
 * the lock is still on this very connection. `undefined`: another executor
 * leads, or the database is not there; `onLost` hears of a dropped connection.
 */
export const acquireLease = async (settings: PostgresSettings, at: Date, onLost: (reason: string) => void): Promise<DispatcherLease | undefined> => {
  const pool = createMaintenancePool(settings)
  let ending: Promise<void> | undefined
  const end = () => ending ??= pool.end().catch(() => undefined)
  pool.on("error", () => { onLost("the dispatcher connection failed") })
  const transaction = transactionWith(pool, { lock: efacturaSubmissionsLockKey, adapter: (client: TransactionClient) => client,
    onBeginFailure: lost("a dispatcher transaction could not begin"), onCommitFailure: lost("a dispatcher transaction could not commit") })
  const query = <A>(use: (client: TransactionClient) => Promise<A>) => transaction((client) => Effect.tryPromise({
    try: () => use(client), catch: (error) => error instanceof LeadershipLost ? error : new LeadershipLost({ reason: "a dispatcher transaction failed" }),
  }))
  try {
    const { rows } = await pool.query<{ readonly locked: boolean }>("SELECT pg_try_advisory_lock($1,$2) AS locked", KEY)
    if (rows[0]?.locked !== true) {
      await end()
      return undefined
    }
    const epoch = await Effect.runPromise(query(async (client) => {
      const row = firstRow((await client.query(BUMP, [at.toISOString(), ...KEY])).rows)
      if (row === undefined) throw new LeadershipLost({ reason: "the dispatcher lock is not on this connection" })
      return integer(row, "epoch")
    }))
    return {
      epoch, pool, end,
      run: (use) => query(async (client) => { await fenced(client, epoch); return use(client) }),
      verify: async () => (await pool.query(FENCE, [epoch, ...KEY])).rowCount === 1,
    }
  } catch {
    await end()
    return undefined
  }
}
