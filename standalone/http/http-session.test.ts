import assert from "node:assert/strict"
import { once } from "node:events"
import { writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import test from "node:test"

import { apiDocsResponse } from "./api-docs.ts"
import { startServer } from "./http.ts"
import { withMigrated, type TestFixture } from "../storage/postgres-rig.test-support.ts"

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
    fixture.config({ port: 0, authTokenFile: tokenFile }),
    fixture.pool,
    () => Promise.resolve(true),
    async () => {
      docsAttempts += 1
      if (docsAttempts === 1) throw new Error("simulated docs render failure")
      return apiDocsResponse()
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
    const anonymousDocs = await fetch(`${origin}/api`)
    assert.equal(anonymousDocs.status, 401)
    const failedDocs = await fetch(`${origin}/api`, { headers: { cookie } })
    assert.equal(failedDocs.status, 500)
    assert.deepEqual(await failedDocs.json(), { error: "internal_failure" })
    const docs = await fetch(`${origin}/api`, { headers: { cookie } })
    assert.equal(docs.status, 200)
    assert.match(docs.headers.get("content-type") ?? "", /^text\/html/)
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
    const bearerWithBadCookie = await fetch(`${origin}/api/customers`, {
      headers: { authorization: `Bearer ${token}`, cookie: `${cookie}x` },
    })
    assert.equal(bearerWithBadCookie.status, 200)
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
 * `nodeEnvironment` is what decides the `Secure` attribute
 * (`standalone/auth/browser-session.ts`), and the only probe that drives a real
 * backend end to end speaks plain HTTP, so it has to run that backend as
 * `development`. Above the session unit the production attribute was therefore
 * asserted nowhere. Both answers are pinned here over the same plain-HTTP
 * transport, so the only thing that differs between them is the configuration.
 */
const issuedSessionCookie = async (fixture: TestFixture, nodeEnvironment: string, token: string): Promise<string> => {
  const tokenFile = join(fixture.dataDirectory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  const running = await startServer(
    fixture.config({ port: 0, authTokenFile: tokenFile, nodeEnvironment }),
    fixture.pool,
    () => Promise.resolve(true),
  )
  try {
    if (!running.server.listening) await once(running.server, "listening")
    const address = running.server.address() as AddressInfo
    const origin = `http://127.0.0.1:${String(address.port)}`
    const login = await fetch(`${origin}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ token }),
    })
    assert.equal(login.status, 200)
    const setCookie = login.headers.get("set-cookie")
    assert.ok(setCookie, "a successful login must issue the session cookie")
    return setCookie
  } finally {
    await running.close()
  }
}

void test("a production host marks the session cookie Secure, a development host does not", async () => {
  await withMigrated("http_cookie_policy", async (fixture) => {
    const token = "c".repeat(64)
    const production = await issuedSessionCookie(fixture, "production", token)
    assert.match(production, /; Secure/u)
    assert.match(production, /; HttpOnly/u)
    assert.match(production, /; SameSite=Strict/u)
    // Same transport, same database, same token: only the environment changed,
    // so the missing attribute is the policy and not the plain-HTTP origin.
    const development = await issuedSessionCookie(fixture, "development", token)
    assert.doesNotMatch(development, /; Secure/u)
    assert.match(development, /; HttpOnly/u)
    assert.match(development, /; SameSite=Strict/u)
  })
})
