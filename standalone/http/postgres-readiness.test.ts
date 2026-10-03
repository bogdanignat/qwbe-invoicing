import assert from "node:assert/strict"
import test from "node:test"

import { runtimeConfig } from "../config.ts"
import { route } from "./http-request-listener.ts"
import { cachedReadiness } from "./readiness.ts"

/**
 * The gate's own behaviour, with no database in sight — which is the point:
 * liveness, the cache and the configuration guard must not need one.
 */

void test("liveness never depends on readiness", () => {
  // `route` is given `false` for every path that is not /health/ready, because
  // the listener does not evaluate readiness for them.
  assert.deepEqual(route("GET", "/health/live", false), { status: 200, body: { status: "live" } })
  assert.equal(route("GET", "/", false).status, 200)
  assert.equal(route("GET", "/health/ready", false).status, 503)
  assert.equal(route("GET", "/health/ready", true).status, 200)
})

void test("concurrent callers share one evaluation and the value is recorded atomically", async () => {
  let calls = 0
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const ready = cachedReadiness(async () => {
    calls += 1
    await gate
    return true
  }, 5_000)
  const first = ready()
  const second = ready()
  release?.()
  assert.deepEqual(await Promise.all([first, second]), [true, true])
  assert.equal(calls, 1, "the second caller must join the run in flight")
  // Inside the interval the answer comes from the cache, not from a new run.
  assert.equal(await ready(), true)
  assert.equal(calls, 1)
})

void test("a failed check answers false and is not cached", async () => {
  let calls = 0
  const ready = cachedReadiness(() => {
    calls += 1
    if (calls === 1) return Promise.reject(new Error("database unavailable"))
    return Promise.resolve(true)
  }, 60_000)
  assert.equal(await ready(), false)
  // The failure is not pinned for the whole interval: the next call retries.
  assert.equal(await ready(), true)
  assert.equal(calls, 2)
})

void test("a stale value is replaced once the interval has passed", async () => {
  let answer = false
  let clock = 0
  const ready = cachedReadiness(() => Promise.resolve(answer), 1_000, () => clock)
  assert.equal(await ready(), false)
  answer = true
  assert.equal(await ready(), false, "still inside the interval")
  clock = 1_001
  assert.equal(await ready(), true)
})

void test("the PG secret is fail-closed outside development", () => {
  const base = { PGHOST: "db", PGPORT: "5432", PGDATABASE: "d", PGUSER: "u" }
  assert.throws(
    () => runtimeConfig({ ...base, NODE_ENV: "production" }),
    /PGPASSWORD_FILE is required outside development/u,
  )
  assert.throws(
    () => runtimeConfig({ ...base, NODE_ENV: "staging", PGPASSWORD_FILE: "/nonexistent/pg-password" }),
    /PGPASSWORD_FILE is not readable/u,
  )
  // Development and test keep the empty password: the throwaway rigs are `trust`.
  assert.equal(runtimeConfig({ ...base, NODE_ENV: "development" }).pgSettings.password, "")
  assert.equal(runtimeConfig({ ...base, NODE_ENV: "test" }).pgSettings.password, "")
})
