import assert from "node:assert/strict"
import { spawn, type ChildProcessByStdio } from "node:child_process"
import { connect, createServer, type Server, type Socket } from "node:net"
import type { Readable } from "node:stream"
import test from "node:test"

import { tryAcquireMaintenanceLock, releaseMaintenanceLock } from "../storage/postgres-maintenance-lock.ts"
import { migratedFixture, type TestFixture } from "../storage/postgres-rig.test-support.ts"

/**
 * The real `serve` process, as evidence for the cleanup fix.
 *
 * Nothing in production changes here. Two things are proven by running the actual
 * CLI as a child, because neither can be proven by calling `startServer` in
 * process:
 *
 * 1. A failed `listen` (the port is already taken) exits **1** within a bound and
 *    leaves nothing behind — in particular the SHARED maintenance barrier is free
 *    afterwards, which is the regression that mattered: a hung holder made
 *    `migrate`/`backup`/`restore` refuse until it was SIGKILLed.
 * 2. With the database unreachable the process still listens: `/health/live` is
 *    200, `/health/ready` is 503, and SIGTERM ends it within a bound.
 * 3. On a reachable database, where the barrier really is held, SIGTERM exits
 *    **0** and gives the barrier back.
 * 4. A request that never finishes its body does not hold the shutdown hostage:
 *    the drain is escalated, the sockets are cut, and the sequence still ends
 *    the query pool and releases the barrier itself, well before the deadline
 *    that would abandon the process.
 *
 * The exit code is pinned exactly in every case, never `0 || 1`: the whole point
 * of `runShutdown` is that the status distinguishes a finished shutdown from an
 * abandoned one, and an assertion that accepts both cannot see a regression in
 * either direction. 1 is proven end to end by case 1 and 3 by case 3; the
 * failure paths of the sequence itself are driven in `shutdown.test.ts` and
 * measured against a real server in `shutdown-barrier.test.ts`.
 *
 * Every timer is cleared and the only process ever signalled is the child this
 * test spawned. Addresses are `127.0.0.1` on an ephemeral port, so two files can
 * run this concurrently.
 */

/** Ceilings. Generous against a loaded host, bounded so a hang fails the test. */
const bootMillis = 20_000
const exitMillis = 20_000
const pollMillis = 200

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => { server.close(() => { resolve() }) })

/** A listener that holds a port, so the child's `listen` must fail. */
const occupiedPort = async (): Promise<{ readonly port: number; readonly release: () => Promise<void> }> => {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => { resolve() })
  })
  const address = server.address()
  assert.ok(address !== null && typeof address === "object", "the fixture server must report an address")
  return { port: address.port, release: () => closeServer(server) }
}

/** A port nothing is listening on: taken and given back before the child starts. */
const freePort = async (): Promise<number> => {
  const held = await occupiedPort()
  await held.release()
  return held.port
}

/** `stdio: ["ignore", "pipe", "pipe"]` is what `spawn` is given, so this is its type. */
type ServeProcess = ChildProcessByStdio<null, Readable, Readable>

interface Child {
  readonly process: ServeProcess
  readonly output: () => string
  readonly exited: Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>
}

const spawnServe = (fixture: TestFixture, overrides: Readonly<Record<string, string>>): Child => {
  const child = spawn("node", ["bin/qwbe-invoicing.ts", "serve"], {
    cwd: process.cwd(),
    env: fixture.childEnv({ HOST: "127.0.0.1", ...overrides }),
    stdio: ["ignore", "pipe", "pipe"],
  })
  let captured = ""
  child.stdout.on("data", (chunk: Buffer) => { captured += chunk.toString("utf8") })
  child.stderr.on("data", (chunk: Buffer) => { captured += chunk.toString("utf8") })
  return {
    process: child,
    output: () => captured,
    exited: new Promise((resolve) => {
      child.once("exit", (code, signal) => { resolve({ code, signal }) })
    }),
  }
}

/** Waits for the child to exit, bounded. The timer is always cleared. */
const exitWithin = async (child: Child, millis: number): Promise<{ readonly code: number | null }> => {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => { resolve("timeout") }, millis) })
  try {
    const result = await Promise.race([child.exited, timeout])
    assert.notEqual(result, "timeout", `the process did not exit within ${String(millis)}ms: ${child.output()}`)
    return result as { readonly code: number | null }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Only ever the child this test owns, and only if it is still running. */
const stopChild = async (child: Child): Promise<void> => {
  if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill("SIGKILL")
  await child.exited.catch(() => undefined)
}

const sleep = (millis: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, millis) })

const statusWithin = async (url: string, millis: number): Promise<number> => {
  const deadline = Date.now() + millis
  let lastFailure = "no attempt"
  while (Date.now() < deadline) {
    try {
      return (await fetch(url)).status
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "unknown"
      await sleep(pollMillis)
    }
  }
  throw new Error(`${url} never answered within ${String(millis)}ms (${lastFailure})`)
}

/** Polls until the endpoint answers `200`, bounded: readiness opens asynchronously. */
const readyWithin = async (url: string, millis: number): Promise<number> => {
  const deadline = Date.now() + millis
  let last = 0
  while (Date.now() < deadline) {
    last = await statusWithin(url, millis)
    if (last === 200) return last
    await sleep(pollMillis)
  }
  return last
}

/** Whether anyone holds the maintenance barrier right now. Takes and gives back. */
const barrierLocked = async (fixture: TestFixture): Promise<boolean> => {
  const client = await fixture.pool.connect()
  try {
    const taken = await tryAcquireMaintenanceLock(client)
    if (taken) await releaseMaintenanceLock(client)
    return !taken
  } finally {
    client.release()
  }
}

void test("serve on an occupied port exits 1 and leaves the maintenance barrier free", async () => {
  const fixture = await migratedFixture("cli_eaddrinuse")
  const held = await occupiedPort()
  const child = spawnServe(fixture, { PORT: String(held.port) })
  try {
    const { code } = await exitWithin(child, exitMillis)
    assert.equal(code, 1, `expected exit 1, got ${String(code)}: ${child.output()}`)
    assert.match(child.output(), /serve could not listen/u)
    assert.match(child.output(), /EADDRINUSE/u)
    // The regression: a process that failed to listen used to hang while holding
    // the SHARED barrier, so every maintenance command refused.
    assert.equal(await barrierLocked(fixture), false, "the barrier must be free after the failed boot")
    // And no secret is echoed into the diagnostics. The literal of whichever rig
    // is running is read off the fixture, never written here: the old assertion
    // matched `compose.test.yaml`'s password, so under `pnpm verify` — which runs
    // in the other rig, with another password — it could not have failed on a
    // real leak. Nothing prints the secret: the message carries its length.
    const secret = fixture.settings.password
    // Kept honest rather than silently skipped: a rig with a secret file must
    // have a non-empty secret, and a `trust` rig has nothing to leak.
    assert.equal(secret.length > 0, (process.env.PGPASSWORD_FILE ?? "").length > 0)
    if (secret.length > 0) {
      assert.ok(
        !child.output().includes(secret),
        `the child echoed the ${String(secret.length)}-character database secret`,
      )
    }
  } finally {
    await stopChild(child)
    await held.release()
    await fixture.close()
  }
})

void test("serve with the database unreachable listens, answers live 200 and ready 503, then stops on SIGTERM", async () => {
  const fixture = await migratedFixture("cli_db_down")
  const port = await freePort()
  // A valid secret and a development configuration: the only thing wrong is that
  // nothing listens on the database port, so no auth bypass is involved.
  const child = spawnServe(fixture, { PORT: String(port), PGPORT: "1", NODE_ENV: "development" })
  try {
    const base = `http://127.0.0.1:${String(port)}`
    assert.equal(await statusWithin(`${base}/health/live`, bootMillis), 200)
    assert.equal((await fetch(`${base}/health/ready`)).status, 503)
    // Liveness keeps answering while readiness stays shut.
    assert.equal((await fetch(`${base}/health/live`)).status, 200)
    child.process.kill("SIGTERM")
    const { code } = await exitWithin(child, exitMillis)
    // 0, pinned: with the server unreachable every step of the sequence really
    // does finish. `startMaintenanceSession` never took the barrier, so
    // `release()` returns on `state.client === undefined`
    // (`postgres-maintenance-session.ts:191`); `closeQueries` and `close` end
    // pools that never handed out a client. A shutdown that reports 1 here means
    // a step started failing, which is exactly what this has to catch.
    assert.equal(code, 0, `expected a clean exit, got ${String(code)}: ${child.output()}`)
    assert.equal(await barrierLocked(fixture), false, "the barrier must be free after shutdown")
  } finally {
    await stopChild(child)
    await fixture.close()
  }
})

void test("serve on a reachable database holds the barrier, answers ready 200, and SIGTERM exits 0", async () => {
  const fixture = await migratedFixture("cli_sigterm_clean")
  const port = await freePort()
  const child = spawnServe(fixture, { PORT: String(port), NODE_ENV: "development" })
  try {
    const base = `http://127.0.0.1:${String(port)}`
    assert.equal(await statusWithin(`${base}/health/live`, bootMillis), 200)
    // The barrier is really held on this path, which is what the DB-down case
    // cannot exercise: readiness is 200 only once `barrier.held()` is true.
    assert.equal(await readyWithin(`${base}/health/ready`, bootMillis), 200, child.output())
    assert.equal(await barrierLocked(fixture), true, "the running process must hold the barrier")
    child.process.kill("SIGTERM")
    const { code } = await exitWithin(child, exitMillis)
    // The normal shutdown, pinned at 0: drain, the query pool, the barrier and
    // the remaining pools all finished. Anything else is a regression, and the
    // failure message carries the child's own `shutdown <step>:` lines.
    assert.equal(code, 0, `expected a clean exit, got ${String(code)}: ${child.output()}`)
    assert.doesNotMatch(child.output(), /shutdown \w+:/u, "no step may report a failure on a clean shutdown")
    assert.equal(await barrierLocked(fixture), false, "the barrier must be free after shutdown")
  } finally {
    await stopChild(child)
    await fixture.close()
  }
})

void test("serve cuts a request that never finishes its body and still shuts down before the deadline", async () => {
  const fixture = await migratedFixture("cli_sigterm_escalate")
  const port = await freePort()
  const child = spawnServe(fixture, { PORT: String(port), NODE_ENV: "development" })
  let socket: Socket | undefined
  try {
    const base = `http://127.0.0.1:${String(port)}`
    assert.equal(await statusWithin(`${base}/health/live`, bootMillis), 200)
    // Ready first: without it the forwarder answers 503 before reading the body
    // and the drain has nothing to wait for. The socket is opened only now, on a
    // port that is known to listen.
    assert.equal(await readyWithin(`${base}/health/ready`, bootMillis), 200, child.output())
    socket = connect(port, "127.0.0.1")
    // The server cuts this socket on purpose; the reset must not fail the test.
    socket.on("error", () => {})
    const opened = socket
    const socketClosed = new Promise<void>((resolve) => { opened.once("close", () => { resolve() }) })
    await new Promise<void>((resolve) => { opened.once("connect", () => { resolve() }) })
    // The body is read before authentication, so no credential is needed to
    // leave a request waiting on it: 1000 bytes announced, one sent.
    socket.write([
      "POST /api/invoices HTTP/1.1",
      "Host: 127.0.0.1",
      "Content-Type: application/json",
      "Content-Length: 1000",
      "",
      "{",
    ].join("\r\n"))
    await sleep(500)
    const started = Date.now()
    child.process.kill("SIGTERM")
    const { code } = await exitWithin(child, exitMillis)
    const elapsed = Date.now() - started
    // 1: a drain that had to be forced is a failed drain, as on the reject path.
    assert.equal(code, 1, `expected exit 1, got ${String(code)}: ${child.output()}`)
    assert.match(child.output(), /shutdown drain: still draining after 5000ms/u)
    // No other step failed, so the barrier was released by the sequence itself and
    // not freed by the process dying (a failed `endQueries` abandons at once).
    assert.doesNotMatch(child.output(), /shutdown (queries|barrier|pools|destroy):/u)
    // The deadline abandons at 10 s; the escalation must finish before it.
    assert.ok(elapsed < 9_500, `shutdown took ${String(elapsed)}ms: ${child.output()}`)
    await socketClosed
    assert.equal(await barrierLocked(fixture), false, "the barrier must be free after shutdown")
  } finally {
    socket?.destroy()
    await stopChild(child)
    await fixture.close()
  }
})
