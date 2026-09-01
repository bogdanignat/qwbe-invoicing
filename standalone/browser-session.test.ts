import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createBrowserSession } from "./browser-session.ts"
import { applyMigrations } from "./migrations.ts"

void test("an opaque browser session survives a host restart, enforces CSRF, and can be revoked", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-session-"))
  const token = "a".repeat(64)
  const tokenFile = join(directory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  const config = {
    host: "127.0.0.1",
    port: 3000,
    dataDirectory: directory,
    nodeEnvironment: "production",
    authTokenFile: tokenFile,
    organizationId: "org-1",
  }
  const now = Date.parse("2026-09-01T10:00:00.000Z")
  let currentTime = now

  try {
    applyMigrations(directory)
    const initialHost = createBrowserSession(config, () => currentTime)
    const login = initialHost.login({ token, origin: "https://invoice.test", host: "invoice.test" })
    assert.equal(login.kind, "authenticated")
    assert.match(login.setCookie, /HttpOnly/)
    assert.match(login.setCookie, /SameSite=Strict/)
    assert.match(login.setCookie, /Secure/)
    assert.doesNotMatch(login.setCookie, new RegExp(token))
    const cookie = login.setCookie.split(";", 1)[0] as string

    currentTime += 1_000
    const restartedHost = createBrowserSession(config, () => currentTime)
    const resumed = restartedHost.resume(cookie)
    assert.deepEqual(resumed, { kind: "authenticated", csrfToken: login.csrfToken })
    assert.deepEqual(restartedHost.authorize({ cookie, method: "GET" }), {
      kind: "authorized",
      authorization: `Bearer ${token}`,
    })
    assert.deepEqual(restartedHost.authorize({
      cookie,
      method: "POST",
      csrfToken: login.csrfToken,
      origin: "https://invoice.test",
      host: "invoice.test",
    }), { kind: "authorized", authorization: `Bearer ${token}` })
    assert.deepEqual(restartedHost.authorize({
      cookie,
      method: "POST",
      origin: "https://invoice.test",
      host: "invoice.test",
    }), { kind: "forbidden" })
    assert.deepEqual(restartedHost.authorize({
      cookie,
      method: "POST",
      csrfToken: login.csrfToken,
      origin: "https://attacker.example",
      host: "invoice.test",
    }), { kind: "forbidden" })
    assert.deepEqual(restartedHost.resume(`${cookie}; ${cookie}`), { kind: "unauthorized" })
    assert.deepEqual(restartedHost.resume(`${cookie}x`), { kind: "unauthorized" })
    assert.equal(restartedHost.revoke(cookie), true)
    assert.deepEqual(restartedHost.resume(cookie), { kind: "unauthorized" })

    const beforeRotation = restartedHost.login({ token, origin: "https://invoice.test", host: "invoice.test" })
    assert.equal(beforeRotation.kind, "authenticated")
    const beforeRotationCookie = beforeRotation.setCookie.split(";", 1)[0] as string
    const rotatedToken = "c".repeat(64)
    writeFileSync(tokenFile, rotatedToken, { mode: 0o600 })
    const rotatedHost = createBrowserSession(config, () => currentTime)
    assert.deepEqual(rotatedHost.resume(beforeRotationCookie), { kind: "unauthorized" })

    const expiring = rotatedHost.login({ token: rotatedToken, origin: "https://invoice.test", host: "invoice.test" })
    assert.equal(expiring.kind, "authenticated")
    const expiringCookie = expiring.setCookie.split(";", 1)[0] as string
    currentTime += 31 * 24 * 60 * 60 * 1_000
    assert.deepEqual(rotatedHost.resume(expiringCookie), { kind: "unauthorized" })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
