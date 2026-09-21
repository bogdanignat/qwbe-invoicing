import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { URL } from "node:url"

import { handleProxyRequest } from "../frontend/src/lib/server/proxy.ts"
import { startServer } from "../standalone/http/http.ts"
import { applyMigrations } from "../standalone/storage/migrations.ts"

void test("HTTP development preview accepts the backend's non-Secure session cookie", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-frontend-http-"))
  const token = "h".repeat(64)
  const tokenFile = join(directory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  applyMigrations(directory)
  const backend = await startServer({ host: "127.0.0.1", port: 0, dataDirectory: directory,
    nodeEnvironment: "development", authTokenFile: tokenFile, organizationId: "org-http" }, () => true)
  try {
    if (!backend.server.listening) await once(backend.server, "listening")
    const address = backend.server.address()
    const publicOrigin = "http://invoicing-preview.example.test"
    const config = { frontendOrigin: new URL(publicOrigin), upstreamBase: new URL(`http://127.0.0.1:${String(address.port)}`), timeoutMs: 2_000 }
    const request = (method, headers = {}, body) => new globalThis.Request(`${publicOrigin}/api/qwbe/session`, {
      method, headers: { host: "invoicing-preview.example.test", ...headers }, ...(body === undefined ? {} : { body }),
    })
    const login = await handleProxyRequest(request("POST", { origin: publicOrigin, "content-type": "application/json" },
      JSON.stringify({ token })), config)
    assert.equal(login.status, 200)
    const setCookie = login.headers.getSetCookie()[0]
    assert.ok(setCookie)
    assert.doesNotMatch(setCookie, /; Secure(?:;|$)/)
    const cookie = setCookie.split(";", 1)[0]
    const resumed = await handleProxyRequest(request("GET", { cookie }), config)
    assert.equal(resumed.status, 200)
    assert.equal((await resumed.json()).authenticated, true)
  } finally {
    await backend.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
