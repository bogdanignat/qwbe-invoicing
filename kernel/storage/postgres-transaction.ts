import { Effect } from "effect"
import type { Pool, PoolClient } from "pg"

import { maintenanceLockKey } from "./postgres-maintenance-lock.ts"
import type { Row } from "./postgres-rows.ts"
import type { QueryValue } from "./postgres-sql.ts"

/**
 * One transaction, one connection, and an owned handle that knows what is still
 * in flight on it.
 *
 * SQLite opened a file and ran `BEGIN IMMEDIATE`: a single writer, enforced by
 * the engine. PostgreSQL has no such mode, so the same serialisation is taken
 * explicitly, and in this order, on EVERY transaction:
 *
 * 1. the SHARED maintenance barrier, transaction-scoped — `migrate`, `backup`
 *    and `restore` hold the same key EXCLUSIVE, so a writer cannot start while
 *    maintenance runs and maintenance cannot start while writers are live;
 * 2. the logical lock for the scope, EXCLUSIVE. Business and payments share one
 *    key because they share one transaction surface today; documents has its
 *    own, and the sessions key is reserved for the session store.
 *
 * The order is load-bearing: a transaction that took the logical lock first and
 * then waited for the barrier could deadlock against maintenance.
 *
 * Isolation is READ COMMITTED, which is PostgreSQL's default and matches what
 * `BEGIN IMMEDIATE` gave: the exclusive logical lock, not the isolation level,
 * is what serialises the writers, so nothing retries and no external effect is
 * ever replayed.
 */

export interface AdvisoryLockKey {
  readonly classId: number
  readonly objectId: number
}

/** Business and payments: one surface, one key. */
export const businessLockKey: AdvisoryLockKey = { classId: maintenanceLockKey.classId, objectId: 2 }
/** Document artifact metadata: separate, so a PDF write cannot block issuance. */
export const documentsLockKey: AdvisoryLockKey = { classId: maintenanceLockKey.classId, objectId: 3 }
/** Reserved for the browser session store, which the integration step ports. */
export const sessionsLockKey: AdvisoryLockKey = { classId: maintenanceLockKey.classId, objectId: 4 }

export interface QueryResult {
  readonly rows: ReadonlyArray<Row>
  /** `pg` answers `null` for statements with no row count; 0 is the honest value. */
  readonly rowCount: number
}

/**
 * What an adapter is handed: the one connection of the open transaction, with
 * every query tracked. It cannot commit, roll back, release or reconnect —
 * lifecycle belongs to the handle.
 */
export interface TransactionClient {
  readonly query: (sql: string, values?: ReadonlyArray<QueryValue>) => Promise<QueryResult>
}

/**
 * The handle's three phases, and the reason they exist.
 *
 * `Effect.tryPromise` with a zero-argument `try` compiles to a bare `OP_ASYNC`
 * with no canceler: verified in the installed driver of the runtime, not assumed
 * — `core-effect.js` takes the `evaluate.length >= 1` branch only when the thunk
 * accepts an `AbortSignal`, and `core.js:async_` attaches `onInterrupt` only
 * when the register returns a canceler or an `AbortController` was created.
 * Neither happens here, so an interrupt resumes the fiber and **abandons the
 * running async function**: the adapter body keeps executing.
 *
 * That matters because an adapter body is multi-statement. `saveIssuedInvoice`
 * sends a header, N lines and M breakdown rows sequentially inside ONE
 * `tryPromise`. Interrupted at statement 3, the finalizer would roll back and
 * return the client to the pool while the abandoned continuation still held a
 * reference to it — statements 4..M would then run on a connection the pool had
 * already handed to the next transaction, in autocommit or inside a foreign
 * transaction, and would be committed by it.
 *
 * The phase makes that unrepresentable instead of unlikely:
 *
 * - `accepting` — the only phase in which `executor.query` reaches the client;
 * - `closing` — set BEFORE anything is drained, by both the commit and the
 *   finalizer, so no further statement can be enqueued while the transaction is
 *   being wound up;
 * - `returned` — the client is back in the pool (or destroyed) and belongs to
 *   someone else.
 *
 * A late `executor.query` therefore fails synchronously, with no I/O, on a
 * fiber that is already interrupted and discards the failure.
 */
type TransactionPhase = "accepting" | "closing" | "returned"

interface TransactionHandle {
  readonly client: PoolClient
  readonly executor: TransactionClient
  /**
   * Resolves when nothing is in flight on this connection, failures included.
   * Loops: a statement enqueued in the same microtask window in which the phase
   * flipped is still awaited before the connection is touched.
   */
  readonly drain: () => Promise<void>
  open: boolean
  phase: TransactionPhase
}

/** Refusal of a statement sent after the transaction stopped accepting them. */
export class TransactionClosed extends Error {
  constructor(phase: TransactionPhase) {
    super(`statement rejected: the transaction is ${phase}`)
    this.name = "TransactionClosed"
  }
}

const lockValues = (key: AdvisoryLockKey): ReadonlyArray<QueryValue> => [key.classId, key.objectId]

const poison = (error: unknown, fallback: string): Error =>
  error instanceof Error ? error : new Error(fallback)

const openTransaction = async (pool: Pool, logical: AdvisoryLockKey): Promise<TransactionHandle> => {
  const client = await pool.connect()
  const inFlight = new Set<Promise<unknown>>()
  const handle: TransactionHandle = {
    client,
    executor: {
      query: async (sql, values) => {
        // Checked before any I/O and on every statement: the guard is what stops
        // an abandoned continuation, so it cannot be a check done once.
        if (handle.phase !== "accepting") throw new TransactionClosed(handle.phase)
        const running = client.query<Row>(sql, values === undefined ? undefined : [...values])
        inFlight.add(running)
        try {
          const result = await running
          return { rows: result.rows, rowCount: result.rowCount ?? 0 }
        } finally {
          inFlight.delete(running)
        }
      },
    },
    drain: async () => {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight])
    },
    open: false,
    phase: "accepting",
  }
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED")
    handle.open = true
    await client.query("SELECT pg_advisory_xact_lock_shared($1,$2)", [...lockValues(maintenanceLockKey)])
    await client.query("SELECT pg_advisory_xact_lock($1,$2)", [...lockValues(logical)])
    return handle
  } catch (error) {
    // `acquireUseRelease` does not run the finalizer for a failed acquire
    // (driver probe g16), so the acquire returns the client it already took —
    // destroyed, because the state of a half-begun transaction is not known.
    handle.phase = "returned"
    try { client.release(poison(error, "transaction acquisition failed")) } catch { /* the original failure wins */ }
    throw error
  }
}

const commitTransaction = async (handle: TransactionHandle): Promise<void> => {
  // Stop accepting first, then drain: the transaction and every statement share
  // one connection, so an in-flight statement has to settle before COMMIT is
  // written to it (driver probe g15) and no new one may join after.
  handle.phase = "closing"
  await handle.drain()
  handle.open = false
  handle.phase = "returned"
  try {
    await handle.client.query("COMMIT")
    handle.client.release()
  } catch (error) {
    // A COMMIT that fails leaves the session in an unknown state and may have
    // lost the connection outright; it must not go back to the pool (probe g17).
    try { handle.client.release(poison(error, "commit failed")) } catch { /* nothing left to do */ }
    throw error
  }
}

/**
 * The finalizer. Exactly once, never rejecting, and it waits: a pending query
 * must settle before ROLLBACK, or two statements would race on one connection,
 * and no statement is accepted from that moment on.
 * A ROLLBACK that fails destroys the client instead of returning it (probe g18).
 */
const releaseTransaction = async (handle: TransactionHandle): Promise<void> => {
  if (handle.phase === "returned") return
  // The order is the whole point: refuse new statements, then wait for the ones
  // already sent, then roll back. Reversing it would let an abandoned
  // continuation write after the ROLLBACK.
  handle.phase = "closing"
  await handle.drain()
  let failure: Error | undefined
  if (handle.open) {
    try {
      await handle.client.query("ROLLBACK")
      handle.open = false
    } catch (error) {
      failure = poison(error, "rollback failed")
    }
  }
  handle.phase = "returned"
  try { handle.client.release(failure) } catch { /* nothing left to do */ }
}

export interface TransactionOptions<Transaction, Failure> {
  readonly lock: AdvisoryLockKey
  readonly adapter: (client: TransactionClient) => Transaction
  readonly onBeginFailure: () => Failure
  readonly onCommitFailure: () => Failure
}

/**
 * The transaction combinator the stores are built from.
 *
 * `Effect.acquireUseRelease` makes the acquire and the finalizer
 * uninterruptible; the COMMIT is wrapped explicitly because the `use` step is
 * not, and an interrupt arriving between the last query and the commit must not
 * abandon an open transaction on a pooled connection.
 */
export const transactionWith = <Transaction, Failure>(
  pool: Pool,
  options: TransactionOptions<Transaction, Failure>,
) => <Value, UseFailure, Requirements>(
  use: (transaction: Transaction) => Effect.Effect<Value, UseFailure, Requirements>,
): Effect.Effect<Value, UseFailure | Failure, Requirements> =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => openTransaction(pool, options.lock),
      catch: options.onBeginFailure,
    }),
    (handle) => Effect.tap(
      use(options.adapter(handle.executor)),
      () => Effect.uninterruptible(Effect.tryPromise({
        try: () => commitTransaction(handle),
        catch: options.onCommitFailure,
      })),
    ),
    (handle) => Effect.promise(() => releaseTransaction(handle)),
  )
