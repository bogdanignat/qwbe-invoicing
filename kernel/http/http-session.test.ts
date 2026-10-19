import assert from "node:assert/strict"
import { once } from "node:events"
import { writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import test from "node:test"

import { apiDocsResponse } from "./api-docs.ts"
import { edgeRequest } from "./edge-transport.test-support.ts"
import { startServer } from "./http.ts"
import { allPlugins } from "../plugins.ts"
import { withMigrated, type TestFixture } from "../storage/postgres-rig.test-support.ts"
import { writeFakeUiDist } from "./ui-dist.test-support.ts"

/**
 * The session exchange end to end. Two ports: the server takes the application
 * pool, and the readiness gate it is handed is a promise — the real gate opens a
 * transaction now, so `() => true` became `() => Promise.resolve(true)`.
 */
void test("the HTTP host exchanges the API token for a cookie session", async () => {
  await withMigrated("http_session", async (fixture) => {
  const token = "b".repeat(64)
  const tokenFile = join(fixture.dataDirectory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  let docsAttempts = 0
  const running = await startServer(
    fixture.config({ port: 0, authTokenFile: tokenFile, bearerApi: true }),
    fixture.pool,
    () => Promise.resolve(true),
    async () => {
      docsAttempts += 1
      if (docsAttempts === 1) throw new Error("simulated docs render failure")
      return apiDocsResponse(allPlugins)()
    },
  )
  const { server } = running

  try {
    if (!server.listening) await once(server, "listening")
    const address = server.address() as AddressInfo
    const origin = `http://127.0.0.1:${String(address.port)}`
    const login = await fetch(`${origin}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ token }),
    })
    assert.equal(login.status, 200)
    const setCookie = login.headers.get("set-cookie")
    assert.ok(setCookie)
    const cookie = setCookie.split(";", 1)[0] as string
    const loginBody = await login.json() as { readonly csrfToken: string }
    assert.equal(typeof loginBody.csrfToken, "string")

    const resumed = await fetch(`${origin}/api/session`, { headers: { cookie } })
    assert.equal(resumed.status, 200)
    // Without a session the docs page sends the browser to `/unlock` and clears
    // whatever session cookie it had; a render failure stays a 500.
    const anonymousDocs = await fetch(`${origin}/api`, { redirect: "manual" })
    assert.equal(anonymousDocs.status, 303)
    assert.equal(anonymousDocs.headers.get("location"), "/unlock")
    assert.match(anonymousDocs.headers.get("set-cookie") ?? "", /^qwbe_session=; .*Max-Age=0/u)
    const failedDocs = await fetch(`${origin}/api`, { headers: { cookie }, redirect: "manual" })
    assert.equal(failedDocs.status, 500)
    assert.deepEqual(await failedDocs.json(), { error: "internal_failure" })
    const docs = await fetch(`${origin}/api`, { headers: { cookie } })
    assert.equal(docs.status, 200)
    assert.match(docs.headers.get("content-type") ?? "", /^text\/html/)
    // The Swagger page brings its own CSP (inline bundle) and keeps every other
    // security header of the edge.
    assert.match(docs.headers.get("content-security-policy") ?? "", /script-src 'unsafe-inline'/u)
    assert.equal(docs.headers.get("cross-origin-opener-policy"), "same-origin")
    assert.equal(docs.headers.get("referrer-policy"), "no-referrer")
    assert.equal(docs.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()")
    assert.equal(docs.headers.get("x-content-type-options"), "nosniff")
    assert.equal(docs.headers.get("cache-control"), "no-store")
    const docsHtml = await docs.text()
    assert.match(docsHtml, /SwaggerUIBundle/)
    assert.match(docsHtml, /QWBE Invoicing API/)
    assert.equal(docsAttempts, 2)
    const customers = await fetch(`${origin}/api/customers`, { headers: { cookie } })
    assert.equal(customers.status, 200)
    const rejectedWrite = await fetch(`${origin}/api/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify({}),
    })
    assert.equal(rejectedWrite.status, 403)
    // A session cookie beside a valid Bearer credential is refused outright,
    // whichever of the two is valid: neither mechanism may be chosen for it.
    const bearerWithBadCookie = await fetch(`${origin}/api/customers`, {
      headers: { authorization: `Bearer ${token}`, cookie: `${cookie}x` },
    })
    assert.equal(bearerWithBadCookie.status, 400)
    assert.deepEqual(await bearerWithBadCookie.json(), { error: "mixed_credentials" })
    assert.equal((await fetch(`${origin}/api/customers`, { headers: { authorization: `Bearer ${token}` } })).status, 200)
    const logout = await fetch(`${origin}/api/session`, {
      method: "DELETE",
      headers: { cookie, origin, "x-csrf-token": loginBody.csrfToken },
    })
    assert.equal(logout.status, 200)
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/)
    const replay = await fetch(`${origin}/api/session`, { headers: { cookie } })
    assert.equal(replay.status, 401)
  } finally {
    await running.close()
  }
  })
})

/**
 * The shipped cookie policy, at the port, on a real database.
 *
 * `Secure` follows production OR an HTTPS public origin
 * (`kernel/auth/browser-session.ts`), for the issued cookie and the clearing
 * one alike. Every case speaks plain HTTP to the same port, with the Host the
 * configured origin pins, so the only thing that differs between them is the
 * configuration.
 */
interface CookiePolicy { readonly issued: string; readonly cleared: string }

const sessionCookiePolicy = async (
  fixture: TestFixture,
  nodeEnvironment: string,
  publicOrigin: string | undefined,
  token: string,
): Promise<CookiePolicy> => {
  const tokenFile = join(fixture.dataDirectory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  const running = await startServer(
    // Production refuses to serve without a UI build; the fake one is enough here.
    fixture.config({ port: 0, authTokenFile: tokenFile, nodeEnvironment, publicOrigin,
      uiDirectory: writeFakeUiDist({}, fixture.dataDirectory) }),
    fixture.pool,
    () => Promise.resolve(true),
  )
  try {
    if (!running.server.listening) await once(running.server, "listening")
    const port = (running.server.address() as AddressInfo).port
    const origin = publicOrigin ?? `http://127.0.0.1:${String(port)}`
    const host = new URL(origin).host
    const login = await edgeRequest(port, { method: "POST", path: "/api/session",
      headers: { host, origin, "content-type": "application/json" }, body: JSON.stringify({ token }) })
    assert.equal(login.status, 200)
    const issued = login.headers["set-cookie"]?.[0] ?? ""
    assert.ok(issued, "a successful login must issue the session cookie")
    const docs = await edgeRequest(port, { path: "/api", headers: { host, cookie: `qwbe_session=${"x".repeat(43)}` } })
    assert.equal(docs.status, 303)
    const cleared = docs.headers["set-cookie"]?.[0] ?? ""
    assert.match(cleared, /^qwbe_session=; .*Max-Age=0/u)
    return { issued, cleared }
  } finally {
    await running.close()
  }
}

void test("production or an HTTPS public origin marks the session cookies Secure, a plain development host does not", async () => {
  await withMigrated("http_cookie_policy", async (fixture) => {
    const token = "c".repeat(64)
    const production = await sessionCookiePolicy(fixture, "production", "https://invoice.test", token)
    const httpsDevelopment = await sessionCookiePolicy(fixture, "development", "https://invoice.test", token)
    for (const cookie of [production.issued, production.cleared, httpsDevelopment.issued, httpsDevelopment.cleared]) {
      assert.match(cookie, /; Secure/u)
      assert.match(cookie, /; HttpOnly/u)
      assert.match(cookie, /; SameSite=Strict/u)
    }
    // Same transport, same database, same token: only the configuration changed,
    // so the missing attribute is the policy and not the plain-HTTP origin.
    const development = await sessionCookiePolicy(fixture, "development", undefined, token)
    for (const cookie of [development.issued, development.cleared]) {
      assert.doesNotMatch(cookie, /; Secure/u)
      assert.match(cookie, /; HttpOnly/u)
      assert.match(cookie, /; SameSite=Strict/u)
    }
  })
})
