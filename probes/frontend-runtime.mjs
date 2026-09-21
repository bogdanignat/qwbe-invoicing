import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import test from "node:test"
import { URL } from "node:url"

import { abortAfterFirstChunk, httpRequest, startBackendFixture, startFrontend, startUpstreamFixture } from "./frontend-runtime-fixture.mjs"

const json = (response) => JSON.parse(response.body.toString("utf8"))
const canonicalHeaders = (origin, extra = {}) => ({ host: new URL(origin).host, ...extra })

void test("standalone runtime preserves backend auth, request guards, methods, and page-only CSP", { timeout: 30_000 }, async () => {
  const backend = await startBackendFixture()
  let frontend
  try {
    frontend = await startFrontend(backend.origin)
    const headers = (extra = {}) => canonicalHeaders(frontend.origin, extra)
    const login = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/session", method: "POST",
      headers: headers({ origin: frontend.origin, "content-type": "application/json" }),
      chunks: [JSON.stringify({ token: backend.token })] })
    assert.equal(login.status, 200)
    assert.deepEqual(Object.keys(json(login)).sort(), ["authenticated", "csrfToken"])
    const cookieHeader = login.headers["set-cookie"]
    assert.ok(Array.isArray(cookieHeader) && cookieHeader.length === 1)
    const cookie = cookieHeader[0].split(";", 1)[0]
    const csrfToken = json(login).csrfToken

    const resumed = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/session", headers: headers({ cookie }) })
    assert.equal(resumed.status, 200)
    assert.equal(json(resumed).authenticated, true)
    const rejected = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/session", method: "DELETE",
      headers: headers({ cookie, origin: frontend.origin, "x-csrf-token": `${csrfToken}x` }) })
    assert.equal(rejected.status, 403)
    const logout = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/session", method: "DELETE",
      headers: headers({ cookie, origin: frontend.origin, "x-csrf-token": csrfToken }) })
    assert.equal(logout.status, 200)
    assert.match(logout.headers["set-cookie"]?.[0] ?? "", /Max-Age=0/u)
    const replay = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/session", headers: headers({ cookie }) })
    assert.equal(replay.status, 401)

    for (const [name, invalidHeaders, status] of [
      ["wrong host", { host: "foreign.example.test" }, 400],
      ["missing origin", {}, 403],
      ["null origin", { origin: "null" }, 403],
      ["foreign origin", { origin: "https://foreign.example.test" }, 403],
      ["forwarded host", { origin: frontend.origin, "x-forwarded-host": "foreign.example.test" }, 400],
      ["forwarded proto", { origin: frontend.origin, "x-forwarded-proto": "https" }, 400],
      ["comma forwarding", { origin: frontend.origin, "x-forwarded-host": `${new URL(frontend.origin).host}, foreign.example.test` }, 400],
      ["comma proto", { origin: frontend.origin, "x-forwarded-proto": "http,https" }, 400],
      ["authorization", { origin: frontend.origin, authorization: "Bearer synthetic-not-a-secret" }, 400],
    ]) {
      const result = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/session", method: "POST",
        headers: { ...headers({ "content-type": "application/json" }), ...invalidHeaders }, chunks: ["{}"] })
      assert.equal(result.status, status, name)
    }
    const duplicateCookie = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/session", headers: [
      "Host", new URL(frontend.origin).host, "Cookie", "qwbe_session=", "Cookie", cookie,
    ] })
    assert.equal(duplicateCookie.status, 400)

    for (const method of ["HEAD", "OPTIONS"]) {
      const direct = await httpRequest({ origin: backend.origin, path: "/api/session", method })
      const proxied = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/session", method, headers: headers() })
      assert.equal(proxied.status, direct.status, `${method} status`)
      assert.equal(proxied.headers.allow, direct.headers.allow, `${method} allow`)
    }

    const unlock = await httpRequest({ origin: frontend.origin, path: "/unlock", headers: headers() })
    assert.equal(unlock.status, 200)
    const policy = unlock.headers["content-security-policy"] ?? ""
    const nonce = /script-src[^;]*'nonce-([^']+)'/u.exec(policy)?.[1]
    assert.ok(nonce)
    assert.match(unlock.body.toString("utf8"), new RegExp(`<script[^>]+nonce=["']${nonce}["']`, "u"))
    const health = await httpRequest({ origin: frontend.origin, path: "/healthz", headers: headers() })
    const api = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/session", headers: headers() })
    assert.equal(health.headers["content-security-policy"], undefined)
    assert.equal(api.headers["content-security-policy"], undefined)
  } finally {
    await frontend?.close()
    await backend.close()
  }
})

void test("standalone runtime preserves raw upstream semantics and closes aborted streams", { timeout: 30_000 }, async () => {
  const upstream = await startUpstreamFixture()
  let frontend
  try {
    frontend = await startFrontend(upstream.origin)
    const headers = canonicalHeaders(frontend.origin)
    const binary = await httpRequest({ origin: frontend.origin,
      path: "/api/qwbe/documents/customer%2F1/value%25raw?a=1&a=2", headers })
    assert.equal(binary.status, 200)
    assert.deepEqual(binary.body, upstream.binary)
    assert.equal(binary.headers.etag, '"runtime-binary"')
    assert.equal(binary.headers["content-disposition"], 'attachment; filename="runtime.bin"')
    const redirect = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/redirect", headers })
    assert.equal(redirect.status, 502)
    assert.equal(redirect.headers.location, undefined)
    assert.deepEqual(json(redirect), { error: "upstream_unavailable" })
    const unavailable = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/unavailable", headers })
    assert.equal(unavailable.status, 502)
    assert.deepEqual(json(unavailable), { error: "upstream_unavailable" })
    const rate = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/rate", headers })
    assert.equal(rate.status, 429)
    assert.equal(rate.headers["retry-after"], "17")
    const service = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/service", headers })
    assert.equal(service.status, 503)

    const oversized = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/customers", method: "POST",
      headers: canonicalHeaders(frontend.origin, { origin: frontend.origin, "content-type": "application/octet-stream" }),
      chunks: [Buffer.alloc(600_000), Buffer.alloc(400_001)] })
    assert.equal(oversized.status, 413)
    assert.equal(upstream.oversizedAttempts(), 0)

    await abortAfterFirstChunk({ origin: frontend.origin, path: "/api/qwbe/stream", headers })
    await upstream.waitFor(() => upstream.activeStreams() === 0, 2_000)
  } finally {
    await frontend?.close()
    await upstream.close()
  }
})

void test("standalone runtime enforces the deployed upstream deadline", { timeout: 60_000 }, async () => {
  const upstream = await startUpstreamFixture()
  let frontend
  try {
    frontend = await startFrontend(upstream.origin)
    const response = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/slow",
      headers: canonicalHeaders(frontend.origin), timeoutMs: 40_000 })
    assert.equal(response.status, 504)
    assert.deepEqual(json(response), { error: "upstream_timeout" })
  } finally {
    await frontend?.close()
    await upstream.close()
  }
})
