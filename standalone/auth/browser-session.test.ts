import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import { createBrowserSession } from "./browser-session.ts"
import { createSessionStore } from "./browser-session-store.ts"
import { withMigrated } from "../storage/postgres-rig.test-support.ts"

/**
 * The same session contract, now asynchronous: every entry point is a query, so
 * every call is awaited. "A host restart" is still a second `createBrowserSession`
 * over the same storage — the pool is the process-wide resource, so the restarted
 * host shares it, which is exactly what a restarted process would get.
 *
 * One assertion is new rather than ported: `expires_at` is `BIGINT`, which `pg`
 * hands over as text, so the test reads the raw column and the decoded record and
 * holds the store to turning the first into a real number.
 */

void test("an opaque browser session survives a host restart, enforces CSRF, and can be revoked", async () => {
  await withMigrated("browser_session", async (fixture) => {
    const { pool, sql } = fixture
    const token = "a".repeat(64)
    const tokenFile = join(fixture.dataDirectory, "api-token")
    writeFileSync(tokenFile, token, { mode: 0o600 })
    const config = fixture.config({ nodeEnvironment: "production", authTokenFile: tokenFile })
    const now = Date.parse("2026-09-01T10:00:00.000Z")
    let currentTime = now

    const initialHost = createBrowserSession(config, pool, () => currentTime)
    const login = await initialHost.login({ token, origin: "https://invoice.test", host: "invoice.test" })
    assert.equal(login.kind, "authenticated")
    assert.match(login.setCookie, /HttpOnly/)
    assert.match(login.setCookie, /SameSite=Strict/)
    assert.match(login.setCookie, /Secure/)
    assert.doesNotMatch(login.setCookie, new RegExp(token))
    const cookie = login.setCookie.split(";", 1)[0] as string

    // The stored epoch is BIGINT: text on the wire, a number after decoding.
    const storedExpiry = await sql.scalar("SELECT expires_at FROM browser_sessions")
    assert.equal(typeof storedExpiry, "string")
    const [stored] = await sql.query<{ readonly session_hash: string }>("SELECT session_hash FROM browser_sessions")
    assert.ok(stored)
    const record = await createSessionStore(pool).find(stored.session_hash)
    assert.ok(record)
    assert.equal(typeof record.expiresAt, "number")
    assert.equal(record.expiresAt, now + 30 * 24 * 60 * 60 * 1_000)
    assert.equal(String(record.expiresAt), storedExpiry)
    assert.equal(record.csrfToken, login.csrfToken)

    currentTime += 1_000
    const restartedHost = createBrowserSession(config, pool, () => currentTime)
    const resumed = await restartedHost.resume(cookie)
    assert.deepEqual(resumed, { kind: "authenticated", csrfToken: login.csrfToken })
    assert.deepEqual(await restartedHost.authorize({ cookie, method: "GET" }), {
      kind: "authorized",
      authorization: `Bearer ${token}`,
    })
    assert.deepEqual(await restartedHost.authorize({
      cookie,
      method: "POST",
      csrfToken: login.csrfToken,
      origin: "https://invoice.test",
      host: "invoice.test",
    }), { kind: "authorized", authorization: `Bearer ${token}` })
    assert.deepEqual(await restartedHost.authorize({
      cookie,
      method: "POST",
      origin: "https://invoice.test",
      host: "invoice.test",
    }), { kind: "forbidden" })
    assert.deepEqual(await restartedHost.authorize({
      cookie,
      method: "POST",
      csrfToken: login.csrfToken,
      origin: "https://attacker.example",
      host: "invoice.test",
    }), { kind: "forbidden" })
    assert.deepEqual(await restartedHost.resume(`${cookie}; ${cookie}`), { kind: "unauthorized" })
    assert.deepEqual(await restartedHost.resume(`${cookie}x`), { kind: "unauthorized" })
    assert.equal(await restartedHost.revoke(cookie), true)
    assert.deepEqual(await restartedHost.resume(cookie), { kind: "unauthorized" })

    const beforeRotation = await restartedHost.login({ token, origin: "https://invoice.test", host: "invoice.test" })
    assert.equal(beforeRotation.kind, "authenticated")
    const beforeRotationCookie = beforeRotation.setCookie.split(";", 1)[0] as string
    const rotatedToken = "c".repeat(64)
    writeFileSync(tokenFile, rotatedToken, { mode: 0o600 })
    const rotatedHost = createBrowserSession(config, pool, () => currentTime)
    assert.deepEqual(await rotatedHost.resume(beforeRotationCookie), { kind: "unauthorized" })

    const expiring = await rotatedHost.login({ token: rotatedToken, origin: "https://invoice.test", host: "invoice.test" })
    assert.equal(expiring.kind, "authenticated")
    const expiringCookie = expiring.setCookie.split(";", 1)[0] as string
    currentTime += 31 * 24 * 60 * 60 * 1_000
    assert.deepEqual(await rotatedHost.resume(expiringCookie), { kind: "unauthorized" })
    // The write path collects what has expired, under the same lock.
    await rotatedHost.login({ token: rotatedToken, origin: "https://invoice.test", host: "invoice.test" })
    assert.equal(Number(await sql.scalar("SELECT count(*) FROM browser_sessions")), 1)
  })
})
