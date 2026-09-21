import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setTimeout } from "node:timers"
import { URL } from "node:url"

import { handleProxyRequest } from "../frontend/src/lib/server/proxy.ts"
import { startServer } from "../standalone/http/http.ts"
import { applyMigrations } from "../standalone/storage/migrations.ts"
import { close, frontendOrigin, listen, proxyRequest } from "./frontend-proxy-fixture.mjs"

void test("BFF exchanges credentials with the real backend and preserves session/CSRF semantics", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-frontend-proxy-"))
  const token = "p".repeat(64)
  const tokenFile = join(directory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  applyMigrations(directory)
  const backend = await startServer({ host: "127.0.0.1", port: 0, dataDirectory: directory,
    nodeEnvironment: "development", authTokenFile: tokenFile, organizationId: "org-proxy" }, () => true)
  try {
    if (!backend.server.listening) await once(backend.server, "listening")
    const address = backend.server.address()
    const config = { frontendOrigin: new URL(frontendOrigin), upstreamBase: new URL(`http://127.0.0.1:${String(address.port)}`), timeoutMs: 2_000 }
    const login = await handleProxyRequest(proxyRequest("session", { method: "POST", headers: {
      origin: frontendOrigin, "content-type": "application/json",
    }, body: JSON.stringify({ token }) }), config)
    assert.equal(login.status, 200)
    assert.deepEqual(Object.keys(await login.clone().json()).sort(), ["authenticated", "csrfToken"])
    const setCookie = login.headers.getSetCookie()[0]
    assert.match(setCookie, /; Secure;/)
    const cookie = setCookie.split(";", 1)[0]
    const { csrfToken } = await login.json()

    const resumed = await handleProxyRequest(proxyRequest("session", { headers: { cookie } }), config)
    assert.equal(resumed.status, 200)
    const rejected = await handleProxyRequest(proxyRequest("session", { method: "DELETE", headers: {
      cookie, origin: frontendOrigin, "x-csrf-token": `${csrfToken}x`,
    } }), config)
    assert.equal(rejected.status, 403)
    const logout = await handleProxyRequest(proxyRequest("session", { method: "DELETE", headers: {
      cookie, origin: frontendOrigin, "x-csrf-token": csrfToken,
    } }), config)
    assert.equal(logout.status, 200)
    const clearCookie = logout.headers.getSetCookie()[0]
    assert.match(clearCookie, /Max-Age=0/)
    assert.match(clearCookie, /; Secure$/)
    const replay = await handleProxyRequest(proxyRequest("session", { headers: { cookie } }), config)
    assert.equal(replay.status, 401)
    assert.match(replay.headers.getSetCookie()[0], /; Secure$/)

    const authorization = await handleProxyRequest(proxyRequest("customers", { headers: { authorization: `Bearer ${token}` } }), config)
    assert.equal(authorization.status, 400)
    const duplicate = await handleProxyRequest(proxyRequest("session", { headers: { cookie: `qwbe_session=; ${cookie}` } }), config)
    assert.equal(duplicate.status, 400)
  } finally {
    await backend.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

void test("BFF preserves raw paths and binary headers, never follows redirects or retries timeouts", async () => {
  let attempts = 0
  let seenHost
  let seenUrl
  const upstream = createServer((request, response) => {
    attempts += 1
    seenHost = request.headers.host
    seenUrl = request.url
    if (request.url === "/api/slow") return void setTimeout(() => response.end("late"), 100)
    if (request.url === "/api/redirect") { response.writeHead(302, { location: "http://127.0.0.1:1/private" }); response.end(); return }
    if (request.url === "/api/xml") {
      response.writeHead(200, { "content-type": "application/xml", etag: '"sha256-xml"' })
      response.end(Buffer.from([60, 120, 62, 0, 255, 60, 47, 120, 62])); return
    }
    const body = Buffer.from([0, 255, 1, 2, 128])
    response.writeHead(200, { "content-type": "application/pdf", etag: '"sha256-fixture"', "x-internal": "secret",
      "x-seen-url": request.url ?? "", "x-seen-host": request.headers.host ?? "" })
    response.end(body)
  })
  const origin = await listen(upstream)
  const config = { frontendOrigin: new URL(frontendOrigin), upstreamBase: new URL(origin), timeoutMs: 20 }
  try {
    const binary = await handleProxyRequest(proxyRequest("documents/customer%2F1?a=1&a=2&v=%25"), config)
    assert.equal(binary.status, 200)
    assert.deepEqual(new Uint8Array(await binary.arrayBuffer()), new Uint8Array([0, 255, 1, 2, 128]))
    assert.equal(binary.headers.get("etag"), '"sha256-fixture"')
    assert.equal(binary.headers.get("x-internal"), null)
    assert.equal(seenHost, "invoicing-proxy.example.test")
    assert.equal(seenUrl, "/api/documents/customer%2F1?a=1&a=2&v=%25")
    const xml = await handleProxyRequest(proxyRequest("xml"), config)
    assert.deepEqual(new Uint8Array(await xml.arrayBuffer()), new Uint8Array([60, 120, 62, 0, 255, 60, 47, 120, 62]))
    assert.equal(xml.headers.get("etag"), '"sha256-xml"')
    const redirect = await handleProxyRequest(proxyRequest("redirect"), config)
    assert.equal(redirect.status, 502)
    assert.equal(redirect.headers.get("location"), null)
    assert.deepEqual(await redirect.json(), { error: "upstream_unavailable" })
    const beforeTimeout = attempts
    const timeout = await handleProxyRequest(proxyRequest("slow"), config)
    assert.equal(timeout.status, 504)
    assert.deepEqual(await timeout.json(), { error: "upstream_timeout" })
    assert.equal(attempts, beforeTimeout + 1)
  } finally {
    await close(upstream)
  }
})
