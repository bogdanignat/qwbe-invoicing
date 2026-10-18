import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import type { RuntimeConfig } from "../config.ts"
import { createQueryPool } from "../storage/postgres-pool.ts"
import { startServer } from "./http.ts"

/**
 * Serving with the database unreachable. No server is started on port 1, so the
 * pool's connections are refused immediately — the fastest honest stand-in for
 * "the database is down", and it needs no container of its own.
 *
 * What is asserted: the port opens anyway, `/health/live` answers 200 without
 * waiting for storage, `/health/ready` answers 503, a session read that rejects
 * becomes a bounded 500 instead of killing the process, and readiness flipping
 * back to true reopens the gate.
 */

const unreachable = () => createQueryPool({
  host: "127.0.0.1",
  port: 1,
  database: "nothing",
  user: "nobody",
  password: "",
  // Well above the 1000ms liveness budget asserted below: if `/health/live` were
  // waiting on storage, this is what it would be waiting for.
  connectTimeoutMillis: 4_000,
  maxConnections: 2,
  onPoolError: () => {},
})

const configFor = (port: number, tokenFile: string): RuntimeConfig => ({
  host: "127.0.0.1",
  port,
  dataDirectory: mkdtempSync(join(tmpdir(), "qwbe-serve-")),
  nodeEnvironment: "test",
  authTokenFile: tokenFile,
  organizationId: undefined,
  pgSettings: { host: "127.0.0.1", port: 1, database: "nothing", user: "nobody", password: "" },
})

const tokenFile = (): string => {
  const path = join(mkdtempSync(join(tmpdir(), "qwbe-token-")), "api-token")
  writeFileSync(path, randomBytes(24).toString("base64url"))
  return path
}

const address = (server: { address: () => unknown }): number => {
  const value = server.address()
  assert.ok(value !== null && typeof value === "object" && "port" in value)
  return (value as { readonly port: number }).port
}

void test("the server listens with the database down: live is fast, ready is 503", async () => {
  const pool = unreachable()
  const running = await startServer(configFor(0, tokenFile()), pool)
  try {
    const port = address(running.server)
    const started = Date.now()
    const live = await fetch(`http://127.0.0.1:${String(port)}/health/live`)
    const elapsed = Date.now() - started
    assert.equal(live.status, 200)
    assert.deepEqual(await live.json(), { status: "live" })
    // 1000ms ceiling, reasoned: a liveness probe is configured at 1-3s, and the
    // pool's own connect timeout is 4000ms — so anything that waited on storage
    // would blow this, while a route that never touches it answers in single-digit ms.
    assert.ok(elapsed < 1_000, `liveness took ${String(elapsed)}ms`)
    const ready = await fetch(`http://127.0.0.1:${String(port)}/health/ready`)
    assert.equal(ready.status, 503)
    // The process is still here, and so is the server.
    assert.equal((await fetch(`http://127.0.0.1:${String(port)}/health/live`)).status, 200)
  } finally {
    await running.close()
    await pool.end()
  }
})

void test("a session read that rejects answers 500 and the process survives", async () => {
  const pool = unreachable()
  // Readiness forced true so the request reaches the session store, which is the
  // thing that rejects: this is the `GET /api` branch the review flagged.
  const running = await startServer(configFor(0, tokenFile()), pool, () => Promise.resolve(true))
  try {
    const port = address(running.server)
    const cookie = `qwbe_session=${randomBytes(32).toString("base64url")}`
    const answer = await fetch(`http://127.0.0.1:${String(port)}/api`, { headers: { cookie } })
    assert.equal(answer.status, 500)
    assert.deepEqual(await answer.json(), { error: "internal_failure" })
    // No unhandled rejection took the process down with it.
    assert.equal((await fetch(`http://127.0.0.1:${String(port)}/health/live`)).status, 200)
  } finally {
    await running.close()
    await pool.end()
  }
})

void test("readiness recovering reopens the gate without a restart", async () => {
  const pool = unreachable()
  let healthy = false
  const running = await startServer(configFor(0, tokenFile()), pool, () => Promise.resolve(healthy))
  try {
    const port = address(running.server)
    assert.equal((await fetch(`http://127.0.0.1:${String(port)}/health/ready`)).status, 503)
    assert.equal((await fetch(`http://127.0.0.1:${String(port)}/api/session`, { method: "POST" })).status, 503)
    healthy = true
    assert.equal((await fetch(`http://127.0.0.1:${String(port)}/health/ready`)).status, 200)
  } finally {
    await running.close()
    await pool.end()
  }
})
