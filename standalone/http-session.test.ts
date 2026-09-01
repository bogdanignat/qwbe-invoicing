import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { startServer } from "./http.ts"
import { applyMigrations } from "./migrations.ts"

void test("the HTTP host exchanges the API token for a cookie session", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-http-session-"))
  const token = "b".repeat(64)
  const tokenFile = join(directory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  applyMigrations(directory)
  const server = startServer({
    host: "127.0.0.1",
    port: 0,
    dataDirectory: directory,
    nodeEnvironment: "test",
    authTokenFile: tokenFile,
    organizationId: "org-1",
  }, () => true)

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
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error === undefined) resolve(); else reject(error) }) })
    rmSync(directory, { recursive: true, force: true })
  }
})
