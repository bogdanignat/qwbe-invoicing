import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import { createBrowserSession } from "./browser-session.ts"
import { createSessionStore } from "./browser-session-store.ts"
import { maintenanceLockKey } from "../storage/postgres-maintenance-lock.ts"
import { type TestFixture, withMigrated } from "../storage/postgres-rig.test-support.ts"

/**
 * Sliding expiry over the real table, on the injected clock: 12 hours of silence
 * end a session, any accepted request moves the window, 30 days after login end
 * it whatever the activity, and only an accepted request ever writes.
 */

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour
const token = "a".repeat(64)
const origin = "https://invoice.test"
const host = "invoice.test"

const openSession = async (fixture: TestFixture) => {
  const tokenFile = join(fixture.dataDirectory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  const loginAt = Date.parse("2026-09-01T10:00:00.000Z")
  const clock = { at: loginAt }
  const session = createBrowserSession(fixture.config({ nodeEnvironment: "production", authTokenFile: tokenFile }),
    fixture.pool, () => clock.at)
  const login = await session.login({ token, origin, host })
  assert.equal(login.kind, "authenticated")
  const cookie = login.setCookie.split(";", 1)[0] as string
  const expiry = async () => Number(await fixture.sql.scalar("SELECT expires_at FROM browser_sessions"))
  const resumes = async (at: number) => {
    clock.at = at
    return (await session.resume(cookie, "GET")).kind === "authenticated"
  }
  return { session, login, cookie, clock, loginAt, expiry, resumes }
}

void test("the cookie, set once at login, ends with the absolute limit: 30 days", async () => {
  await withMigrated("session_lifetime_cookie", async (fixture) => {
    const { login } = await openSession(fixture)
    assert.match(login.setCookie, /^qwbe_session=[A-Za-z0-9_-]{43}; Path=\/api; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000$/u)
  })
})

void test("12 hours without a request end the session", async () => {
  await withMigrated("session_lifetime_idle", async (fixture) => {
    const { loginAt, expiry, resumes } = await openSession(fixture)
    assert.equal(await expiry(), loginAt + 12 * hour)
    assert.equal(await resumes(loginAt + 12 * hour), false)
  })
})

void test("a request at 11h extends the session for another 12h, and only then", async () => {
  await withMigrated("session_lifetime_sliding", async (fixture) => {
    const { loginAt, expiry, resumes } = await openSession(fixture)
    assert.equal(await resumes(loginAt + 11 * hour), true)
    assert.equal(await expiry(), loginAt + 23 * hour)
    assert.equal(await resumes(loginAt + 22 * hour), true)
    assert.equal(await resumes(loginAt + 34 * hour), false)
  })
})

void test("a request writes only once the window has moved five minutes", async () => {
  await withMigrated("session_lifetime_step", async (fixture) => {
    const { loginAt, expiry, resumes } = await openSession(fixture)
    assert.equal(await resumes(loginAt + 4 * minute), true)
    assert.equal(await expiry(), loginAt + 12 * hour, "no write inside the step")
    assert.equal(await resumes(loginAt + 5 * minute), true)
    assert.equal(await expiry(), loginAt + 5 * minute + 12 * hour)
  })
})

void test("30 days after login the session ends, however active it is", async () => {
  await withMigrated("session_lifetime_absolute", async (fixture) => {
    const { loginAt, expiry, resumes } = await openSession(fixture)
    let at = loginAt
    while (at + 11 * hour < loginAt + 30 * day) {
      at += 11 * hour
      assert.equal(await resumes(at), true, `request at ${String((at - loginAt) / hour)}h`)
    }
    assert.equal(await expiry(), loginAt + 30 * day)
    assert.equal(await resumes(loginAt + 30 * day), false)
  })
})

void test("a refused request does not extend the session, an accepted write does", async () => {
  await withMigrated("session_lifetime_refused", async (fixture) => {
    const { session, login, cookie, clock, loginAt, expiry } = await openSession(fixture)
    clock.at = loginAt + 11 * hour
    assert.deepEqual(await session.authorize({ cookie, method: "POST", origin, host }), { kind: "forbidden" })
    assert.deepEqual(await session.authorize({ cookie, method: "POST", csrfToken: login.csrfToken, origin: "https://attacker.example", host }),
      { kind: "forbidden" })
    assert.equal(await expiry(), loginAt + 12 * hour)
    assert.equal((await session.authorize({ cookie, method: "POST", csrfToken: login.csrfToken, origin, host })).kind, "authorized")
    assert.equal(await expiry(), loginAt + 23 * hour)
  })
})

void test("resuming for a write does not extend: only authorize does, after CSRF", async () => {
  await withMigrated("session_lifetime_resume_write", async (fixture) => {
    const { session, cookie, clock, loginAt, expiry } = await openSession(fixture)
    clock.at = loginAt + 11 * hour
    assert.equal((await session.resume(cookie, "DELETE")).kind, "authenticated")
    assert.equal(await expiry(), loginAt + 12 * hour)
  })
})

void test("concurrent extensions only move forward and never revive an expired row", async () => {
  await withMigrated("session_lifetime_concurrent", async (fixture) => {
    const { session, cookie, clock, loginAt, expiry } = await openSession(fixture)
    clock.at = loginAt + hour
    const answers = await Promise.all(Array.from({ length: 6 }, () => session.authorize({ cookie, method: "GET" })))
    assert.ok(answers.every((answer) => answer.kind === "authorized"))
    assert.equal(await expiry(), loginAt + 13 * hour)

    const store = createSessionStore(fixture.pool)
    const hash = String(await fixture.sql.scalar("SELECT session_hash FROM browser_sessions"))
    const [later] = await Promise.all([
      store.extend(hash, loginAt + 15 * hour, clock.at), store.extend(hash, loginAt + 14 * hour, clock.at)])
    assert.equal(later, true)
    assert.equal(await expiry(), loginAt + 15 * hour, "the later expiry wins whichever order they commit in")
    assert.equal(await store.extend(hash, loginAt + 14 * hour, clock.at), false, "an extension never moves backwards")
    assert.equal(await store.extend(hash, loginAt + 40 * hour, loginAt + 15 * hour), false, "an expired row stays expired")
    assert.equal(await expiry(), loginAt + 15 * hour)
  })
})

void test("an extension waits behind the exclusive maintenance barrier", async () => {
  await withMigrated("session_lifetime_barrier", async (fixture) => {
    const { session, cookie, clock, loginAt, expiry } = await openSession(fixture)
    clock.at = loginAt + hour
    const hash = String(await fixture.sql.scalar("SELECT session_hash FROM browser_sessions"))
    const maintenance = await fixture.pool.connect()
    try {
      await maintenance.query("BEGIN")
      await maintenance.query("SELECT pg_advisory_xact_lock($1, $2)", [maintenanceLockKey.classId, maintenanceLockKey.objectId])
      const extension = createSessionStore(fixture.pool).extend(hash, loginAt + 13 * hour, clock.at)
      const settled = await Promise.race([extension.then(() => true), new Promise<boolean>((resolve) => setTimeout(resolve, 500, false))])
      assert.equal(settled, false, "no extension while maintenance holds the barrier")
      await maintenance.query("COMMIT")
      assert.equal(await extension, true)
    } finally {
      // Destroyed, not returned: a failed assertion must not leave the barrier held on a pooled connection.
      maintenance.release(true)
    }
    assert.equal(await expiry(), loginAt + 13 * hour)
    assert.equal((await session.resume(cookie, "GET")).kind, "authenticated")
  })
})
