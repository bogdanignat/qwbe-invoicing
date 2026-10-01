/**
 * T-1480 step 0b(g) — the `pg` driver API, observed on a live PostgreSQL 16.
 *
 * Isolated stage probe, not runtime code: it answers "what does the installed
 * driver actually do" for the pool/transaction/timeout/decoder questions the
 * PostgreSQL adapter will depend on. Nothing here is imported by the
 * application and nothing here is a contract.
 *
 * Run (the rig is throwaway, on tmpfs, no published port):
 *   docker compose --file compose.pg-driver-probe.yaml run --rm driver-probe
 *   docker compose --file compose.pg-driver-probe.yaml down
 *
 * Every check asserts; a verdict that is not evident from an assertion is a
 * failure, never a printed PASS.
 *
 * Every wait is bounded — the checks, each teardown step and a watchdog over the
 * teardown itself, so a connection that never answers ends the run with an exit
 * code instead of hanging the container. No client, timer or socket is left open
 * on any path. Exit: 0 all checks passed, 1 at least one failed, 3 setup or
 * teardown failed.
 */
import assert from "node:assert/strict"
import { createServer } from "node:net"
import { clearTimeout, setTimeout } from "node:timers"
import { setTimeout as delay } from "node:timers/promises"

import { Duration, Effect, Exit, Fiber } from "effect"
import pg from "pg"

const { Pool } = pg

const schema = `probe_pgdrv_${new Date().toISOString().replace(/\D/gu, "")}_${process.pid}`
const results = []
const observations = []
const pools = new Set()
const sockets = new Set()

const makePool = (config = {}) => {
  const pool = new Pool({ max: 2, connectionTimeoutMillis: 5000, ...config })
  // An idle client that errors must not take the process down with it.
  pool.on("error", (error) => observations.push(`pool error event: ${error.message}`))
  pools.add(pool)
  return pool
}

/** A bound every check runs under, so a hung await fails instead of hanging. */
const bounded = async (name, ms, run) => {
  let timer
  try {
    return await Promise.race([
      run(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${name}: exceeded ${ms}ms bound`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const check = async (name, ms, run) => {
  try {
    const detail = await bounded(name, ms, run)
    results.push({ name, status: "pass", detail: detail ?? "" })
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`)
  } catch (error) {
    results.push({ name, status: "fail", detail: `${error.name}: ${error.message}` })
    console.error(`FAIL ${name} — ${error.stack}`)
  }
}

const rejection = async (run) => {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error("expected a rejection, got success")
}

/** stdout is a pipe under `docker compose run`; exit without draining truncates. */
const flushAndExit = async (code) => {
  await new Promise((resolve) => {
    process.stdout.write("", resolve)
  })
  process.exit(code)
}

/**
 * Errors raised by the server on a checked-out client arrive as an `error` event,
 * and an unhandled one kills the process instead of failing a check. One handler
 * per client, kept idempotent so a recycled client does not accumulate listeners
 * (pg-pool attaches and detaches its own idle listener around each checkout).
 */
const PROBE_ERROR_HANDLER = Symbol("probe-error-handler")
const catchClientErrors = (client, label) => {
  if (client[PROBE_ERROR_HANDLER]) return client
  client[PROBE_ERROR_HANDLER] = true
  client.on("error", (error) => observations.push(`${label} client error event: ${error.message}`))
  return client
}

const maintenance = makePool({ max: 2 })

const idleInTransactionCount = async () => {
  const { rows } = await maintenance.query(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state LIKE 'idle in transaction%' AND pid <> pg_backend_pid()",
  )
  return rows[0].n
}

/* ------------------------------------------------------------------ setup */

// Setup is guarded: a failure here is a setup failure (exit 3), not a failed
// check (exit 1), and it must not leave the maintenance pool or a half-created
// schema behind.
let serverVersion
let driver
try {
  // Qualified DDL: it runs before PGOPTIONS exists, so nothing depends on a
  // search_path the maintenance connection does not have.
  await bounded("setup create schema", 15_000, () => maintenance.query(`CREATE SCHEMA ${schema}`))
  await bounded("setup create tables", 15_000, () =>
    maintenance.query(`
      CREATE TABLE ${schema}.parent (id text PRIMARY KEY, tag text UNIQUE);
      CREATE TABLE ${schema}.child (id text PRIMARY KEY, parent_id text REFERENCES ${schema}.parent(id));
      CREATE TABLE ${schema}.checked (id text PRIMARY KEY, amount text CHECK (amount <> ''));
      CREATE TABLE ${schema}.money (id serial PRIMARY KEY, label text, amount text);
      CREATE TABLE ${schema}.narrow (id text PRIMARY KEY, code varchar(1));
      INSERT INTO ${schema}.parent (id, tag) VALUES ('p1', 't1');
    `),
  )
  // Every pool created from here on inherits the probe schema through libpq's
  // own startup option, so the checks below can use unqualified names.
  process.env.PGOPTIONS = `-c search_path=${schema}`
  serverVersion = (await bounded("setup version", 15_000, () => maintenance.query("SELECT version() AS v"))).rows[0].v
  driver = (await import("pg/package.json", { with: { type: "json" } })).default
  console.log(`driver pg ${driver.version}; server ${serverVersion}; schema ${schema}`)
} catch (error) {
  console.error(`SETUP FAILED — ${error.stack}`)
  // Drop what may already exist, then leave nothing connected.
  await maintenance.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {})
  await maintenance.end().catch(() => {})
  await flushAndExit(3)
}

/* ----------------------------------------------------------------- checks */

await check("g1 startup GUCs are server-side, visible to SHOW", 10_000, async () => {
  const pool = makePool({
    statement_timeout: 1500,
    idle_in_transaction_session_timeout: 2000,
    lock_timeout: 1000,
  })
  const client = await pool.connect()
  try {
    const shown = async (guc) => (await client.query(`SHOW ${guc}`)).rows[0][guc]
    const statement = await shown("statement_timeout")
    const idle = await shown("idle_in_transaction_session_timeout")
    const lock = await shown("lock_timeout")
    assert.equal(statement, "1500ms")
    assert.equal(idle, "2s")
    assert.equal(lock, "1s")
    // The GUCs travel in the startup packet, so they are already in force on
    // the first query of a freshly checked-out client — no SET round trip.
    const applied = await client.query("SHOW search_path")
    assert.equal(applied.rows[0].search_path, schema)
    return `statement_timeout=${statement} idle_in_transaction_session_timeout=${idle} lock_timeout=${lock}; search_path from PGOPTIONS`
  } finally {
    client.release()
  }
})

await check("g2 single client BEGIN/COMMIT and BEGIN/ROLLBACK", 10_000, async () => {
  const pool = makePool()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("INSERT INTO parent (id, tag) VALUES ('c1', 'tc1')")
    await client.query("COMMIT")
    await client.query("BEGIN")
    await client.query("INSERT INTO parent (id, tag) VALUES ('c2', 'tc2')")
    await client.query("ROLLBACK")
    const { rows } = await client.query("SELECT id FROM parent WHERE id IN ('c1','c2') ORDER BY id")
    assert.deepEqual(
      rows.map((row) => row.id),
      ["c1"],
    )
    assert.equal(await idleInTransactionCount(), 0)
    return "committed row visible, rolled back row absent, no session left in transaction"
  } finally {
    client.release()
  }
})

await check("g3 release(error) destroys the connection, release() recycles it", 10_000, async () => {
  const pool = makePool({ max: 1 })
  const first = await pool.connect()
  const firstPid = first.processID
  first.release(new Error("probe: poisoned connection"))
  assert.equal(pool.totalCount, 0, "destroyed client must leave the pool empty")
  const second = await pool.connect()
  const secondPid = second.processID
  assert.notEqual(secondPid, firstPid, "release(err) must not hand the same backend back")
  second.release()
  assert.equal(pool.idleCount, 1, "plain release must return the client to the idle list")
  const third = await pool.connect()
  assert.equal(third.processID, secondPid, "plain release must recycle the same backend")
  third.release()
  return `pid ${firstPid} destroyed, pid ${secondPid} recycled`
})

await check("g4 connectionTimeoutMillis bounds a saturated acquire", 10_000, async () => {
  const pool = makePool({ max: 1, connectionTimeoutMillis: 300 })
  const held = await pool.connect()
  const started = Date.now()
  try {
    const error = await rejection(() => pool.connect())
    const elapsed = Date.now() - started
    assert.match(error.message, /timeout exceeded when trying to connect/u)
    assert.ok(elapsed >= 250 && elapsed < 3000, `acquire rejected after ${elapsed}ms`)
    return `${error.message} after ${elapsed}ms`
  } finally {
    held.release()
  }
})

await check("g5 connectionTimeoutMillis bounds a connect that never answers", 15_000, async () => {
  // A sink in this process: it accepts the TCP connection and then never speaks.
  // Deterministic by construction — no guessed address, no reliance on a subnet
  // mask or on nobody listening. `clearTimeout(this.connectionTimeoutHandle)`
  // only runs at `_handleReadyForQuery`, on connect error or on end
  // (node_modules/pg/lib/client.js:206,377,406), so a completed TCP handshake
  // without a startup answer keeps the timer armed — which is the case under test.
  const sink = createServer((socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  try {
    const port = await bounded("g5 sink listen", 5000, async () => {
      await new Promise((resolve, reject) => {
        sink.once("error", reject)
        sink.listen(0, "127.0.0.1", resolve)
      })
      return sink.address().port
    })
    const pool = makePool({ host: "127.0.0.1", port, connectionTimeoutMillis: 700, max: 1 })
    const started = Date.now()
    const error = await rejection(() => pool.connect())
    const elapsed = Date.now() - started
    assert.ok(elapsed >= 600 && elapsed < 5000, `connect rejected after ${elapsed}ms`)
    assert.match(error.message, /timeout expired|connection timeout/iu)
    return `${error.message} after ${elapsed}ms against a silent TCP sink on 127.0.0.1:${port} (code ${error.code ?? "none"})`
  } finally {
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    await new Promise((resolve) => sink.close(resolve))
  }
})

await check("g6 statement_timeout fires server-side, leaves no idle transaction", 20_000, async () => {
  const pool = makePool({ statement_timeout: 300, max: 1 })
  const client = await pool.connect()
  let error
  try {
    await client.query("BEGIN")
    error = await rejection(() => client.query("SELECT pg_sleep(5)"))
    assert.equal(error.code, "57014", `expected query_canceled, got ${error.code}`)
    // The transaction is aborted but still open: it has to be closed by hand.
    const state = await rejection(() => client.query("SELECT 1"))
    assert.equal(state.code, "25P02", `expected in_failed_sql_transaction, got ${state.code}`)
    await client.query("ROLLBACK")
    assert.equal((await client.query("SELECT 1 AS ok")).rows[0].ok, 1)
    client.release()
  } catch (failure) {
    client.release(failure)
    throw failure
  }
  await pool.end()
  pools.delete(pool)
  assert.equal(pool.totalCount, 0, "pool.end() must leave no connection behind")
  assert.equal(await idleInTransactionCount(), 0)
  return `57014 on the cancelled statement, 25P02 until ROLLBACK, pool ended clean`
})

await check("g7 idle_in_transaction_session_timeout kills the forgotten transaction", 20_000, async () => {
  const pool = makePool({ idle_in_transaction_session_timeout: 400, max: 1 })
  const client = await pool.connect()
  // The server terminates this backend; a checked-out client emits 'error' and
  // an unhandled one would take the process down instead of failing the check.
  catchClientErrors(client, "g7")
  try {
    await client.query("BEGIN")
    await client.query("INSERT INTO parent (id, tag) VALUES ('g7', 'tg7')")
    await delay(1200)
    const error = await rejection(() => client.query("SELECT 1"))
    observations.push(`idle_in_transaction kill surfaces as: ${error.code ?? "no code"} ${error.message}`)
    client.release(error)
    const { rows } = await maintenance.query(`SELECT count(*)::int AS n FROM ${schema}.parent WHERE id = 'g7'`)
    assert.equal(rows[0].n, 0, "the killed transaction must not have committed")
    assert.equal(await idleInTransactionCount(), 0)
    return `${error.code ?? "no code"}: ${error.message}; insert rolled back by the server`
  } catch (failure) {
    client.release(failure)
    throw failure
  }
})

await check("g8 lock_timeout fires on a contended row", 20_000, async () => {
  const holderPool = makePool({ max: 1 })
  const waiterPool = makePool({ lock_timeout: 400, max: 1 })
  const holder = await holderPool.connect()
  const waiter = await waiterPool.connect()
  try {
    await holder.query("BEGIN")
    await holder.query("SELECT id FROM parent WHERE id = 'p1' FOR UPDATE")
    const started = Date.now()
    const error = await rejection(() =>
      waiter.query("SELECT id FROM parent WHERE id = 'p1' FOR UPDATE"),
    )
    const elapsed = Date.now() - started
    assert.equal(error.code, "55P03", `expected lock_not_available, got ${error.code}`)
    assert.ok(elapsed < 5000, `lock wait ended after ${elapsed}ms`)
    await waiter.query("ROLLBACK").catch(() => {})
    await holder.query("ROLLBACK")
    return `55P03 after ${elapsed}ms; native startup GUC, no options= fallback needed`
  } finally {
    holder.release()
    waiter.release()
  }
})

await check("g9 error classes 23xxx and 22xxx as the driver reports them", 15_000, async () => {
  const pool = makePool()
  const client = await pool.connect()
  const seen = {}
  try {
    const record = async (label, sql, values) => {
      const error = await rejection(() => client.query(sql, values))
      seen[label] = { code: error.code, constraint: error.constraint, table: error.table }
      // A failed statement outside an explicit transaction leaves the session
      // usable, so the next case can run on the same client.
      assert.equal((await client.query("SELECT 1 AS ok")).rows[0].ok, 1)
      return error
    }
    const unique = await record("23505", "INSERT INTO parent (id, tag) VALUES ($1, $2)", ["p9", "t1"])
    const fk = await record("23503", "INSERT INTO child (id, parent_id) VALUES ($1, $2)", ["c9", "absent"])
    const chk = await record("23514", "INSERT INTO checked (id, amount) VALUES ($1, $2)", ["k9", ""])
    const cast = await record("22P02", "SELECT $1::int AS n", ["abc"])
    const long = await record("22001", "INSERT INTO narrow (id, code) VALUES ($1, $2)", ["n9", "toolong"])
    assert.equal(unique.code, "23505")
    assert.equal(fk.code, "23503")
    assert.equal(chk.code, "23514")
    assert.equal(cast.code, "22P02")
    assert.equal(long.code, "22001")
    assert.equal(unique.constraint, "parent_tag_key")
    assert.equal(fk.constraint, "child_parent_id_fkey")
    assert.equal(chk.constraint, "checked_amount_check")
    return JSON.stringify(seen)
  } finally {
    client.release()
  }
})

await check("g10 int8 decodes to string; an explicit per-client decoder is isolated", 15_000, async () => {
  const pool = makePool({ max: 2 })
  const plain = await pool.connect()
  const big = "9007199254740993"
  try {
    const row = (await plain.query(`SELECT 1::int8 AS small, ${big}::int8 AS big`)).rows[0]
    assert.equal(typeof row.small, "string", "int8 must not be decoded to a JS number by default")
    assert.equal(row.small, "1")
    assert.equal(row.big, big)
  } finally {
    plain.release()
  }
  const decoded = await pool.connect()
  const other = await pool.connect()
  // Explicit flags: releasing twice throws, so the finally must know what the
  // body already handed back.
  let releasedDecoded = false
  let releasedOther = false
  try {
    // Per-client override: TypeOverrides is owned by the client, so no global
    // parser is installed and the other client of the same pool is unaffected.
    decoded.setTypeParser(20, (text) => {
      const value = Number(text)
      if (!Number.isSafeInteger(value)) throw new RangeError(`int8 out of safe integer range: ${text}`)
      return value
    })
    const row = (await decoded.query("SELECT 42::int8 AS n")).rows[0]
    assert.equal(typeof row.n, "number")
    assert.equal(row.n, 42)
    const unsafe = await rejection(() => decoded.query(`SELECT ${big}::int8 AS n`))
    observations.push(`unsafe int8 through the decoder: ${unsafe.name}: ${unsafe.message}`)
    const untouched = (await other.query("SELECT 42::int8 AS n")).rows[0]
    assert.equal(typeof untouched.n, "string", "the override must not leak to another client")
    // Isolation is between clients, not between checkouts: a plain release()
    // returns the connection with its TypeOverrides still mutated, so the next
    // consumer of that same connection inherits the parser. Probed, so step 3
    // installs parsers once per pool instead of per request.
    other.release(new Error("probe: discard the untouched client to make the next checkout deterministic"))
    releasedOther = true
    decoded.release()
    releasedDecoded = true
    const recycled = await pool.connect()
    const inherited = (await recycled.query("SELECT 42::int8 AS n")).rows[0]
    recycled.release(new Error("probe: discard the client carrying the override"))
    assert.equal(typeof inherited.n, "number", "expected the override to survive a plain release")
    observations.push("setTypeParser survives a plain release(): the recycled connection still decodes int8 to a number")
    return `default string; override number; unsafe → ${unsafe.name}; sibling client still string; override survives release() on the recycled connection`
  } finally {
    if (!releasedDecoded) decoded.release()
    if (!releasedOther) other.release()
  }
})

await check("g11 TEXT money input types, measured against the SQLite baseline", 15_000, async () => {
  const pool = makePool()
  const client = await pool.connect()
  const vectors = [
    ["string-1.00", "1.00"],
    ["number-1", 1],
    ["number-1.5", 1.5],
    ["number-0.1+0.2", 0.1 + 0.2],
    ["number-1e21", 1e21],
    ["number-minus0", -0],
    ["bigint-10", 10n],
  ]
  const stored = {}
  try {
    for (const [label, value] of vectors) {
      try {
        const { rows } = await client.query(
          "INSERT INTO money (label, amount) VALUES ($1, $2) RETURNING amount, pg_typeof(amount)::text AS type",
          [label, value],
        )
        stored[label] = { amount: rows[0].amount, type: rows[0].type }
      } catch (error) {
        stored[label] = { error: `${error.code ?? error.name}: ${error.message}` }
      }
    }
    // The one fact the plan recorded differently on SQLite: a JS 1 was stored
    // as '1.0' there. Asserted, not assumed, so the delta is on the record.
    assert.equal(stored["string-1.00"].amount, "1.00")
    assert.equal(stored["number-1"].amount, "1")
    assert.equal(stored["number-1.5"].amount, "1.5")
    assert.equal(stored["number-0.1+0.2"].amount, "0.30000000000000004")
    for (const [label, value] of Object.entries(stored)) {
      if (value.type) assert.equal(value.type, "text", `${label} stored as ${value.type}`)
    }
    observations.push(`money vectors: ${JSON.stringify(stored)}`)
    return `SQLite '1.0' vs PostgreSQL '${stored["number-1"].amount}' for JS 1; 1e21 → '${stored["number-1e21"].amount ?? stored["number-1e21"].error}'; -0 → '${stored["number-minus0"].amount ?? stored["number-minus0"].error}'; 10n → '${stored["bigint-10"].amount ?? stored["bigint-10"].error}'`
  } finally {
    client.release()
  }
})

/* ------------------------------------- Effect 3 transaction prototype */

/**
 * Prototype only — the shape the adapter would take, probed for finalizer
 * behaviour, not the final pool implementation.
 *
 * A handle tracks the queries it started so the finalizer can wait for an
 * in-flight one before it sends ROLLBACK: the two share one connection, and a
 * pipelined ROLLBACK behind a pending query is what leaves a session stuck in
 * `idle in transaction`.
 */
const openTransaction = (pool, events, options = {}) =>
  // tryPromise, not promise: a failed acquire is a typed error of this effect,
  // not a defect, and the client it already took must go back before the error
  // leaves. acquireUseRelease never calls the finalizer for an acquire that
  // failed, so the only place that can return this client is here.
  Effect.tryPromise({
    try: async () => {
      const client = catchClientErrors(await pool.connect(), "transaction")
      events.push("acquired")
      try {
        if (options.beforeBegin) await client.query(options.beforeBegin)
        // A slow step inside the uninterruptible acquire, so an interrupt can be
        // aimed at it deterministically.
        await client.query(`SELECT pg_sleep(${options.acquireDelaySeconds ?? 0.3})`)
        await client.query("BEGIN")
      } catch (error) {
        events.push(`acquire-failed:${error.code ?? error.name}`)
        // A connection that failed mid-acquire may be in any state: discard it
        // rather than hand it to the next caller.
        client.release(error)
        events.push("destroyed")
        throw error
      }
      events.push("begin")
      return {
        client,
        pending: new Set(),
        query(sql, values) {
          const promise = client.query(sql, values)
          this.pending.add(promise)
          return promise.finally(() => this.pending.delete(promise))
        },
      }
    },
    catch: (error) => error,
  })

const closeTransaction = (handle, exit, events) =>
  Effect.promise(async () => {
    if (handle.pending.size > 0) {
      await Promise.allSettled([...handle.pending])
      events.push("pending-settled")
    }
    if (Exit.isSuccess(exit)) {
      try {
        await handle.client.query("COMMIT")
        events.push("commit")
        handle.client.release()
        events.push("released")
      } catch (error) {
        // COMMIT can fail: a terminated backend, a lost connection, an aborted
        // transaction. The client must still leave, and it must leave destroyed.
        events.push(`commit-failed:${error.code ?? error.name}`)
        handle.client.release(error)
        events.push("destroyed")
      }
      return
    }
    try {
      await handle.client.query("ROLLBACK")
      events.push("rollback")
      handle.client.release()
      events.push("released")
    } catch (error) {
      events.push(`rollback-failed:${error.code ?? error.name}`)
      handle.client.release(error)
      events.push("destroyed")
    }
  })

const withTransaction = (pool, events, use, options) =>
  Effect.acquireUseRelease(
    openTransaction(pool, events, options),
    use,
    (handle, exit) => closeTransaction(handle, exit, events),
  )

/** Kills the backend behind a handle, from the maintenance pool. */
const terminateBackend = async (handle) => {
  await maintenance.query("SELECT pg_terminate_backend($1)", [handle.client.processID])
  // Let the FATAL reach the client before the finalizer runs.
  await delay(200)
}

await check("g12 Effect acquireUseRelease commits on success", 20_000, async () => {
  const pool = makePool({ max: 1 })
  const events = []
  const exit = await Effect.runPromiseExit(
    withTransaction(pool, events, (handle) =>
      Effect.promise(() => handle.query("INSERT INTO parent (id, tag) VALUES ('g12', 'tg12')")),
    ),
  )
  assert.ok(Exit.isSuccess(exit), `expected success, got ${JSON.stringify(exit)}`)
  assert.deepEqual(events, ["acquired", "begin", "commit", "released"])
  const { rows } = await maintenance.query(`SELECT count(*)::int AS n FROM ${schema}.parent WHERE id = 'g12'`)
  assert.equal(rows[0].n, 1)
  assert.equal(pool.idleCount, 1, "the client must be back in the pool")
  assert.equal(await idleInTransactionCount(), 0)
  return events.join(" → ")
})

await check("g13 Effect acquireUseRelease rolls back on failure", 20_000, async () => {
  const pool = makePool({ max: 1 })
  const events = []
  const exit = await Effect.runPromiseExit(
    withTransaction(pool, events, (handle) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => handle.query("INSERT INTO parent (id, tag) VALUES ('g13', 'tg13')"))
        return yield* Effect.fail(new Error("probe: domain failure after the write"))
      }),
    ),
  )
  assert.ok(Exit.isFailure(exit))
  assert.deepEqual(events, ["acquired", "begin", "rollback", "released"])
  const { rows } = await maintenance.query(`SELECT count(*)::int AS n FROM ${schema}.parent WHERE id = 'g13'`)
  assert.equal(rows[0].n, 0, "the failed transaction must not have committed")
  assert.equal(await idleInTransactionCount(), 0)
  return events.join(" → ")
})

await check("g14 interruption: acquire is uninterruptible, finalizer still runs", 25_000, async () => {
  const pool = makePool({ max: 1 })
  const events = []
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        withTransaction(pool, events, (handle) =>
          Effect.gen(function* () {
            // The marker that discriminates the window: if the interrupt had
            // landed in `use` instead of in the acquire it would appear here.
            yield* Effect.sync(() => events.push("use-started"))
            yield* Effect.promise(() => handle.query("INSERT INTO parent (id, tag) VALUES ('g14', 'tg14')"))
            // Interruptible point with a query already committed to the wire.
            yield* Effect.sleep(Duration.seconds(10))
          }),
        ),
      )
      // Lands inside the uninterruptible acquire (pg_sleep(0.3)).
      yield* Effect.sleep(Duration.millis(100))
      return yield* Fiber.interrupt(fiber)
    }),
  )
  assert.ok(Exit.isInterrupted(exit), `expected an interrupted exit, got ${JSON.stringify(exit)}`)
  // Exact sequence: the acquire ran to completion, `use` never started, the
  // finalizer still rolled back. No "use-started" is the discriminating fact.
  assert.deepEqual(events, ["acquired", "begin", "rollback", "released"])
  const { rows } = await maintenance.query(`SELECT count(*)::int AS n FROM ${schema}.parent WHERE id = 'g14'`)
  assert.equal(rows[0].n, 0, "an interrupted transaction must not leave a row")
  assert.equal(await idleInTransactionCount(), 0)
  return events.join(" → ")
})

await check("g15 interruption with a query still in flight settles it before ROLLBACK", 25_000, async () => {
  const pool = makePool({ max: 1 })
  const events = []
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        withTransaction(pool, events, (handle) =>
          Effect.gen(function* () {
            // Started, deliberately not awaited by the fiber: the finalizer has
            // to deal with a pending promise on the same connection.
            yield* Effect.sync(() => {
              handle.query("SELECT pg_sleep(1)").catch(() => {})
            })
            yield* Effect.sleep(Duration.seconds(10))
          }),
        ),
      )
      yield* Effect.sleep(Duration.millis(500))
      return yield* Fiber.interrupt(fiber)
    }),
  )
  assert.ok(Exit.isInterrupted(exit))
  assert.ok(events.includes("pending-settled"), "the in-flight query must settle before cleanup")
  assert.ok(
    events.indexOf("pending-settled") < events.indexOf("rollback"),
    `pending query settled after ROLLBACK: ${events.join(" → ")}`,
  )
  assert.equal(events.at(-1), "released")
  assert.equal(pool.idleCount, 1)
  assert.equal(await idleInTransactionCount(), 0)
  return events.join(" → ")
})

await check("g16 a failure inside the acquire returns the client, destroyed", 20_000, async () => {
  const pool = makePool({ max: 1 })
  const events = []
  const exit = await Effect.runPromiseExit(
    withTransaction(pool, events, () => Effect.succeed("never reached"), { beforeBegin: "SELECT 1 / 0" }),
  )
  assert.ok(Exit.isFailure(exit), "a failed acquire must fail the effect")
  // No "begin": the acquire died before it, and `use` and the finalizer never ran.
  assert.deepEqual(events, ["acquired", "acquire-failed:22012", "destroyed"])
  assert.equal(pool.totalCount, 0, "the client taken by the failed acquire must not stay out")
  assert.equal(pool.idleCount, 0)
  assert.equal(await idleInTransactionCount(), 0)
  // The pool is still usable afterwards, which is what "returned" has to mean.
  const next = await pool.connect()
  next.release()
  return `${events.join(" → ")}; pool usable again`
})

await check("g17 a COMMIT that fails on a lost connection discards the client", 25_000, async () => {
  const pool = makePool({ max: 1 })
  const events = []
  const exit = await Effect.runPromiseExit(
    withTransaction(pool, events, (handle) =>
      Effect.promise(async () => {
        await handle.query("INSERT INTO parent (id, tag) VALUES ('g17', 'tg17')")
        // Connection loss while the transaction is open: COMMIT cannot land.
        await terminateBackend(handle)
      }),
    ),
  )
  assert.ok(Exit.isSuccess(exit), "the use step succeeded; the failure belongs to the finalizer")
  assert.equal(events[0], "acquired")
  assert.equal(events[1], "begin")
  assert.match(events[2], /^commit-failed:/u, `expected a failed COMMIT, got ${events.join(" → ")}`)
  assert.equal(events.at(-1), "destroyed")
  assert.ok(!events.includes("released"), "a client whose COMMIT failed must not be recycled")
  assert.equal(pool.totalCount, 0, "the destroyed client must leave the pool empty")
  const { rows } = await maintenance.query(`SELECT count(*)::int AS n FROM ${schema}.parent WHERE id = 'g17'`)
  assert.equal(rows[0].n, 0, "a transaction killed before COMMIT must not be visible")
  assert.equal(await idleInTransactionCount(), 0)
  return `${events.join(" → ")}; row not committed`
})

await check("g18 a ROLLBACK that fails on a lost connection destroys the client", 25_000, async () => {
  const pool = makePool({ max: 1 })
  const events = []
  const exit = await Effect.runPromiseExit(
    withTransaction(pool, events, (handle) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => handle.query("INSERT INTO parent (id, tag) VALUES ('g18', 'tg18')"))
        yield* Effect.promise(() => terminateBackend(handle))
        return yield* Effect.fail(new Error("probe: domain failure on a dead connection"))
      }),
    ),
  )
  assert.ok(Exit.isFailure(exit))
  assert.match(events[2], /^rollback-failed:/u, `expected a failed ROLLBACK, got ${events.join(" → ")}`)
  assert.equal(events.at(-1), "destroyed")
  assert.ok(!events.includes("released"))
  assert.equal(pool.totalCount, 0)
  const { rows } = await maintenance.query(`SELECT count(*)::int AS n FROM ${schema}.parent WHERE id = 'g18'`)
  assert.equal(rows[0].n, 0)
  assert.equal(await idleInTransactionCount(), 0)
  return events.join(" → ")
})

/* ------------------------------------------------- teardown fault injection */

// `PROBE_FAULT=leak-client` leaves a client checked out on purpose, which is the
// one situation that makes `pool.end()` never settle. It exists so the bounded
// teardown can be observed rather than argued: the run must end with exit 3 and a
// dropped schema, not with a hanging container.
//   docker compose --file compose.pg-driver-probe.yaml run --rm \
//     -e PROBE_FAULT=leak-client driver-probe
if (process.env.PROBE_FAULT === "leak-client") {
  const leaking = makePool({ max: 1 })
  await leaking.connect()
  observations.push("fault injection: a client was left checked out so pool.end() cannot settle")
}

/* --------------------------------------------------------------- teardown */

// `pool.end()` never settles while a client is still checked out (pg-pool
// resolves the end callback from `_pulseQueue`), so every teardown step is
// bounded and the whole phase is under a watchdog: a stuck connection produces
// exit 3, never a container that hangs without a verdict.
const teardownWatchdog = setTimeout(() => {
  console.error("TEARDOWN TIMEOUT — exiting 3; a client or socket did not close")
  process.exit(3)
}, 60_000)
teardownWatchdog.unref()

let teardownFailure
const fail = (error) => {
  teardownFailure = teardownFailure ?? error
}

try {
  for (const pool of pools) {
    if (pool === maintenance) continue
    try {
      await bounded("teardown pool.end", 10_000, () => pool.end())
    } catch (error) {
      // Recorded and carried on: the schema still has to be dropped.
      observations.push(`teardown pool.end: ${error.message}`)
      fail(error)
    }
  }
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  const idle = await bounded("teardown idle-in-transaction count", 10_000, idleInTransactionCount)
  if (idle !== 0) fail(new Error(`a session was left idle in transaction: ${idle}`))
} catch (error) {
  fail(error)
} finally {
  // Unconditional, and only ever this run's own schema: a failed assertion above
  // must not leave an object behind, and a leftover from another run must not
  // fail this one.
  try {
    await bounded("teardown drop schema", 15_000, () =>
      maintenance.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`),
    )
    const own = await bounded("teardown own schema gone", 10_000, () =>
      maintenance.query("SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = $1", [schema]),
    )
    if (own.rows[0].n !== 0) fail(new Error(`own schema ${schema} survived teardown`))
    const foreign = await bounded("teardown foreign schema census", 10_000, () =>
      maintenance.query(
        "SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name LIKE 'probe_pgdrv%' AND schema_name <> $1",
        [schema],
      ),
    )
    if (foreign.rows[0].n !== 0) {
      observations.push(`probe schemas left by other runs (not this run's business): ${foreign.rows[0].n}`)
    }
  } catch (error) {
    fail(error)
  }
  await maintenance.end().catch(() => {})
  clearTimeout(teardownWatchdog)
}

const failed = results.filter((result) => result.status === "fail")
console.log("\n--- observations ---")
for (const observation of observations) console.log(`· ${observation}`)
console.log("\n--- summary ---")
console.log(JSON.stringify({ driver: driver.version, server: serverVersion, results }, null, 2))
console.log(`${results.length - failed.length}/${results.length} checks passed`)

if (teardownFailure) {
  console.error(`TEARDOWN FAILED — ${teardownFailure.stack}`)
  await flushAndExit(3)
}
await flushAndExit(failed.length > 0 ? 1 : 0)
