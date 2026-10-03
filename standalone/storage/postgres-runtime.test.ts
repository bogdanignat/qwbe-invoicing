import assert from "node:assert/strict"
import test from "node:test"

import { Effect, Exit, Fiber } from "effect"

import { PersistenceFailure } from "../../cube/invoicing/index.ts"
import { redactSecrets, writeFailure } from "./postgres-errors.ts"
import { createQueryRuntime } from "./postgres-pool.ts"
import { emptyRuntime, freshRuntime, sessionCount } from "./postgres-rig.test-support.ts"
import { businessTransaction, createPostgresStore } from "./postgres-store.ts"

/**
 * The runtime primitives: the pool, the transaction handle and the finalizer.
 * Every assertion is about what the server and the pool report afterwards, not
 * about what the code intended.
 */

void test("a committed transaction returns its connection and leaves nothing idle in transaction", async () => {
  const runtime = await freshRuntime("commit")
  try {
    const store = createPostgresStore(runtime.pool)
    await Effect.runPromise(store.transaction((transaction) => transaction.addDocumentSeries({
      organizationId: "org-1", documentType: "invoice", series: "QWBE",
    })))
    const found = await Effect.runPromise(store.transaction((transaction) =>
      transaction.findDocumentSeries("org-1", "invoice", "QWBE")))
    assert.equal(found?.series, "QWBE")
    assert.equal(runtime.pool.idleCount > 0, true)
    assert.equal(await sessionCount(runtime.pool, "idle in transaction"), 0)
  } finally {
    await runtime.close()
  }
})

void test("a failing operation rolls back and the connection goes back to the pool", async () => {
  const runtime = await freshRuntime("rollback")
  try {
    const store = createPostgresStore(runtime.pool)
    const failure = await Effect.runPromise(Effect.flip(store.transaction((transaction) =>
      Effect.flatMap(
        transaction.addDocumentSeries({ organizationId: "org-1", documentType: "invoice", series: "QWBE" }),
        () => Effect.fail(new PersistenceFailure({ operation: "deliberate" })),
      ))))
    assert.equal(failure instanceof PersistenceFailure, true)
    // The write inside the failed transaction is gone, so the rollback really ran.
    const found = await Effect.runPromise(store.transaction((transaction) =>
      transaction.findDocumentSeries("org-1", "invoice", "QWBE")))
    assert.equal(found, undefined)
    assert.equal(await sessionCount(runtime.pool, "idle in transaction"), 0)
  } finally {
    await runtime.close()
  }
})

void test("an interrupt with a query in flight waits for it, rolls back and reuses the connection", async () => {
  const runtime = await freshRuntime("interrupt")
  try {
    const raw = businessTransaction(runtime.pool)
    const started: Array<string> = []
    const inFlight = raw((client) => Effect.promise(async () => {
      started.push("query")
      await client.query("SELECT pg_sleep(0.4)")
      started.push("settled")
    }))
    // The fork, the wait and the interrupt live in ONE program: a fiber forked
    // from a root that then finishes would be interrupted by the root's exit,
    // and the interrupt would land in the acquire instead of in the query.
    const exit = await Effect.runPromise(Effect.flatMap(
      Effect.fork(inFlight),
      (fiber) => Effect.flatMap(Effect.sleep("100 millis"), () => Fiber.interrupt(fiber)),
    ))
    assert.equal(Exit.isInterrupted(exit), true)
    // The finalizer awaited the in-flight query before touching the connection:
    // the query reached its own end, and nothing is left in a transaction.
    assert.deepEqual(started, ["query", "settled"])
    assert.equal(await sessionCount(runtime.pool, "idle in transaction"), 0)
    // The same connection is usable immediately afterwards.
    const store = createPostgresStore(runtime.pool)
    await Effect.runPromise(store.transaction((transaction) => transaction.addDocumentSeries({
      organizationId: "org-1", documentType: "invoice", series: "AFTER",
    })))
    const found = await Effect.runPromise(store.transaction((transaction) =>
      transaction.findDocumentSeries("org-1", "invoice", "AFTER")))
    assert.equal(found?.series, "AFTER")
  } finally {
    await runtime.close()
  }
})

void test("a multi-statement body interrupted between statements cannot write after the rollback", async () => {
  const runtime = await freshRuntime("multiquery")
  try {
    const raw = businessTransaction(runtime.pool)
    const order: Array<string> = []
    let firstDone: (() => void) | undefined
    let released: (() => void) | undefined
    let finished: (() => void) | undefined
    const afterFirst = new Promise<void>((resolve) => { firstDone = resolve })
    const gate = new Promise<void>((resolve) => { released = resolve })
    const bodyFinished = new Promise<void>((resolve) => { finished = resolve })

    // One `Effect.tryPromise` whose body sends several statements — the real
    // shape of `saveIssuedInvoice`. The gate is the test's synchronisation, not
    // the fix: it decides WHERE the interrupt lands, and the guard is what makes
    // the second statement impossible afterwards.
    const body = raw((client) => Effect.promise(async () => {
      await client.query(
        "INSERT INTO document_series(organization_id,document_type,series) VALUES($1,$2,$3)",
        ["org-1", "invoice", "FIRST"],
      )
      order.push("statement-1")
      firstDone?.()
      await gate
      try {
        await client.query(
          "INSERT INTO document_series(organization_id,document_type,series) VALUES($1,$2,$3)",
          ["org-1", "invoice", "SECOND"],
        )
        order.push("statement-2-accepted")
      } catch (error) {
        order.push(`statement-2-refused:${error instanceof Error ? error.name : "unknown"}`)
      }
      finished?.()
    }))

    const exit = await Effect.runPromise(Effect.flatMap(
      Effect.fork(body),
      (fiber) => Effect.flatMap(
        Effect.promise(() => afterFirst),
        () => Fiber.interrupt(fiber),
      ),
    ))
    assert.equal(Exit.isInterrupted(exit), true)
    order.push("interrupted")
    // Only now is the abandoned continuation allowed to proceed — after the
    // finalizer has rolled back and returned the client to the pool.
    released?.()
    await bodyFinished

    assert.deepEqual(order, [
      "statement-1", "interrupted", "statement-2-refused:TransactionClosed",
    ])
    // Neither row exists: the first was rolled back, the second never reached
    // the server, so nothing was written on a reallocated connection.
    const { rows } = await runtime.pool.query<{ readonly series: string }>(
      "SELECT series FROM document_series ORDER BY series",
    )
    assert.deepEqual(rows.map((entry) => entry.series), [])
    assert.equal(await sessionCount(runtime.pool, "idle in transaction"), 0)
    // The same connection is safe to reuse: a fresh transaction commits normally.
    const store = createPostgresStore(runtime.pool)
    await Effect.runPromise(store.transaction((transaction) => transaction.addDocumentSeries({
      organizationId: "org-1", documentType: "invoice", series: "AFTER",
    })))
    const reused = await runtime.pool.query<{ readonly series: string }>(
      "SELECT series FROM document_series ORDER BY series",
    )
    assert.deepEqual(reused.rows.map((entry) => entry.series), ["AFTER"])
  } finally {
    await runtime.close()
  }
})

void test("a query-only runtime has no maintenance connection to lose a session lock on", async () => {
  const runtime = createQueryRuntime({
    host: process.env.PGHOST ?? "db", port: Number(process.env.PGPORT ?? "5432"),
    database: process.env.PGDATABASE ?? "adapters", user: process.env.PGUSER ?? "adapters",
    password: process.env.PGPASSWORD ?? "",
  })
  try {
    // The type carries the guarantee; this asserts the value matches it, so the
    // barrier cannot be taken on a pooled, idle-reaped client.
    assert.equal("maintenance" in runtime, false)
    assert.equal(typeof runtime.close, "function")
  } finally {
    await runtime.close()
    await runtime.close()
  }
})

void test("concurrent number allocations serialise on the exclusive lock, with no duplicate", async () => {
  const runtime = await freshRuntime("serialise")
  try {
    const store = createPostgresStore(runtime.pool)
    await Effect.runPromise(store.transaction((transaction) => transaction.addDocumentSeries({
      organizationId: "org-1", documentType: "invoice", series: "QWBE",
    })))
    const allocate = store.transaction((transaction) =>
      transaction.allocateDocumentNumber("org-1", 2026, "invoice", "QWBE"))
    const numbers = await Effect.runPromise(
      Effect.all([allocate, allocate, allocate, allocate], { concurrency: 4 }),
    )
    // Four transactions, four distinct numbers: the logical lock is exclusive on
    // every transaction, so no two allocations interleave.
    assert.deepEqual([...numbers].sort((left, right) => left - right), [1, 2, 3, 4])
    assert.equal(await sessionCount(runtime.pool, "idle in transaction"), 0)
  } finally {
    await runtime.close()
  }
})

void test("closing the runtime is idempotent and a transaction afterwards fails as a persistence failure", async () => {
  const runtime = await emptyRuntime("close")
  const store = createPostgresStore(runtime.pool)
  await runtime.close()
  // Twice: a disposer reachable from both a signal handler and a `finally` must
  // not turn the second call into a failure.
  await runtime.close()
  const failure = await Effect.runPromise(Effect.flip(store.transaction((transaction) =>
    transaction.findDocumentSeries("org-1", "invoice", "QWBE"))))
  assert.equal(failure instanceof PersistenceFailure, true)
  assert.equal(failure.operation, "begin transaction")
})

void test("a failed acquire reports the operation and carries no driver detail", async () => {
  const runtime = await emptyRuntime("acquire")
  try {
    const store = createPostgresStore(runtime.pool)
    // No schema here, so the first domain statement fails inside the transaction.
    const failure = await Effect.runPromise(Effect.flip(store.transaction((transaction) =>
      transaction.findDocumentSeries("org-1", "invoice", "QWBE"))))
    assert.equal(failure instanceof PersistenceFailure, true)
    assert.equal(failure.operation, "find document series")
    // The mapped failure holds the operation and nothing else: no message, no
    // cause, so a connection string with a password cannot travel with it.
    assert.deepEqual(Object.keys(failure).sort(), ["_tag", "operation"])
    assert.equal(await sessionCount(runtime.pool, "idle in transaction"), 0)
  } finally {
    await runtime.close()
  }
})

void test("an unmapped SQLSTATE stays a persistence failure, and secrets are redacted", () => {
  // 42P01 (undefined table) is a defect, not a conflict: it must not become a 409.
  const mapped = writeFailure({ code: "42P01" }, "save customer")
  assert.equal(mapped instanceof PersistenceFailure, true)
  assert.equal(
    redactSecrets("connect failed password=s3cret host=db"),
    "connect failed password=[redacted] host=db",
  )
  assert.equal(
    redactSecrets("postgres://qwbe:s3cret@db:5432/qwbe"),
    "postgres://qwbe:[redacted]@db:5432/qwbe",
  )
})
