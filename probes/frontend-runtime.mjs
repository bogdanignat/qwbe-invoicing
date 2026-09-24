import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import test from "node:test"
import { URL } from "node:url"

import { abortAfterFirstChunk, createTlsMaterial, httpRequest, rawHttpRequest, sessionCookies, startBackendFixture,
  startFrontend, startTlsUpstreamFixture, startUpstreamFixture } from "./frontend-runtime-fixture.mjs"

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

void test("standalone runtime keeps escaped paths off the upstream and refuses a foreign session cookie",
  { timeout: 60_000 }, async () => {
    const upstream = await startUpstreamFixture()
    let frontend
    try {
      frontend = await startFrontend(upstream.origin)
      const headers = canonicalHeaders(frontend.origin)

      // A control request proves the upstream really records what it is asked for,
      // so an empty record below means "nothing arrived", not "nothing is watched".
      const control = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/cookie-foreign", headers })
      assert.equal(control.status, 200)
      assert.deepEqual(upstream.requestedUrls(), ["/api/cookie-foreign"])

      // Paths are written to the socket verbatim: a URL parser in the probe would
      // resolve the traversal before it could ever reach the server under test.
      for (const path of ["/api/qwbe/../health", "/api/qwbe/%2e%2e/health", "/api/qwbe/..%2Fhealth",
        "/api/qwbe/%252e%252e/health", "/api/qwbe/x%2F..%2F..%2Fhealth", "/api/qwbe/customer%5cadmin",
        "/api/qwbe//evil", "/api/qwbe/./../health", "/api/qwbe/.%2e/health", "/api/qwbe/%00"]) {
        const escaped = await rawHttpRequest({ origin: frontend.origin, path, headers })
        assert.notEqual(escaped.status, 200, path)
        assert.deepEqual(upstream.requestedUrls(), ["/api/cookie-foreign"], path)
      }
      assert.equal(control.headers["set-cookie"], undefined)

      const issued = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/cookie-issued", headers })
      assert.equal(issued.status, 200)
      assert.deepEqual(issued.headers["set-cookie"], [sessionCookies.issued])
      const cleared = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/cookie-clear", headers })
      assert.equal(cleared.status, 200)
      assert.deepEqual(cleared.headers["set-cookie"], [sessionCookies.clear])

      // An upstream cookie the contract rejects fails the response; dropping it
      // would answer 200 to a browser that never received the session it expects.
      for (const path of ["cookie-tampered", "cookie-malformed", "cookie-multiple", "cookie-issue-and-clear"]) {
        const refused = await httpRequest({ origin: frontend.origin, path: `/api/qwbe/${path}`, headers })
        assert.equal(refused.status, 502, path)
        assert.deepEqual(json(refused), { error: "invalid_upstream_cookie" }, path)
        assert.equal(refused.headers["set-cookie"], undefined, path)
      }
    } finally {
      await frontend?.close()
      await upstream.close()
    }
  })

void test("standalone runtime carries document downloads through with their own media type",
  { timeout: 30_000 }, async () => {
    const upstream = await startUpstreamFixture()
    let frontend
    try {
      frontend = await startFrontend(upstream.origin)
      const headers = (extra = {}) => canonicalHeaders(frontend.origin, extra)

      // A PDF is rendered by a POST and then read; the read must come back as a
      // PDF, named, and with the validator the upstream issued. A proxy that
      // normalised any of the three would hand the browser a file it saves as
      // the route's last path segment, with the wrong type.
      const rendered = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/invoices/inv-1/pdf",
        method: "POST", headers: headers({ origin: frontend.origin, "content-type": "application/json" }), chunks: ["{}"] })
      assert.equal(rendered.status, 200)
      const pdf = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/invoices/inv-1/pdf",
        headers: headers({ accept: "application/pdf" }) })
      assert.equal(pdf.status, 200)
      assert.deepEqual(pdf.body, upstream.binary)
      assert.equal(pdf.headers["content-type"], "application/pdf")
      assert.equal(pdf.headers["content-disposition"], 'attachment; filename="factura-FCT-12.pdf"')
      assert.equal(pdf.headers.etag, '"invoice-pdf"')

      for (const path of ["/api/qwbe/invoices/inv-1/efactura.xml", "/api/qwbe/corrections/cor-1/efactura.xml"]) {
        const xml = await httpRequest({ origin: frontend.origin, path, headers: headers({ accept: "application/xml" }) })
        assert.equal(xml.status, 200, path)
        assert.equal(xml.headers["content-type"], "application/xml", path)
        assert.equal(xml.headers["content-disposition"], 'attachment; filename="document.xml"', path)
        assert.equal(xml.headers.etag, '"document-xml"', path)
        assert.equal(xml.body.toString("utf8"), "<Invoice/>", path)
      }

      // A download refused as unauthenticated has to arrive as a 401: that status
      // is what the transport reports against the epoch the request left with, and
      // a proxy that rewrote it would leave an expired session on screen.
      const expired = await httpRequest({ origin: frontend.origin, path: "/api/qwbe/invoices/expired/pdf",
        headers: headers({ accept: "application/pdf" }) })
      assert.equal(expired.status, 401)
      assert.deepEqual(json(expired), { error: "unauthorized" })
      assert.equal(expired.headers["set-cookie"], undefined)
    } finally {
      await frontend?.close()
      await upstream.close()
    }
  })

// The public name the deployment answers on, deliberately different from both the
// bound address and every upstream hostname used below.
const publicHost = "invoicing.example.test"

/**
 * One request through a deployed frontend to an HTTPS upstream, under a public
 * origin that is neither the upstream's name nor the address it is bound to.
 *
 * The proxy rewrites `Host` to that public origin, so the handshake is where the
 * upstream identity is decided: each attempt reports both the answer and the
 * server name the upstream saw asked for.
 */
const tlsAttempt = async (material, caPath, { host, path = "/api/qwbe/session" } = {}) => {
  const upstream = await startTlsUpstreamFixture(material, host === undefined ? {} : { host })
  let frontend
  try {
    frontend = await startFrontend(upstream.origin,
      { env: { NODE_EXTRA_CA_CERTS: caPath, FRONTEND_ORIGIN: `http://${publicHost}` } })
    const response = await httpRequest({ origin: frontend.origin, path, headers: { host: publicHost } })
    return { response, serverNames: upstream.serverNames() }
  } finally {
    await frontend?.close()
    await upstream.close()
  }
}

void test("standalone runtime validates the upstream certificate under the upstream hostname",
  { timeout: 90_000 }, async () => {
    const trusted = createTlsMaterial("localhost")
    const mismatched = createTlsMaterial("other.invalid")
    const foreign = createTlsMaterial("localhost")
    try {
      // Unless a server name is given, Node derives both SNI and the identity it
      // checks from the rewritten Host header, and the certificate would be judged
      // under the public name instead of the upstream's own.
      const accepted = await tlsAttempt(trusted, trusted.caPath)
      assert.equal(accepted.response.status, 200)
      assert.deepEqual(json(accepted.response), { tls: true })
      assert.deepEqual(accepted.serverNames, ["localhost"])

      const wrongName = await tlsAttempt(mismatched, mismatched.caPath)
      assert.equal(wrongName.response.status, 502)
      assert.deepEqual(json(wrongName.response), { error: "upstream_unavailable" })

      const unknownIssuer = await tlsAttempt(foreign, trusted.caPath)
      assert.equal(unknownIssuer.response.status, 502)
      assert.deepEqual(json(unknownIssuer.response), { error: "upstream_unavailable" })
    } finally {
      trusted.close()
      mismatched.close()
      foreign.close()
    }
  })

void test("standalone runtime validates an upstream addressed by a literal address against that address",
  { timeout: 120_000 }, async () => {
    const trusted = createTlsMaterial("127.0.0.1", "IP:127.0.0.1")
    const otherAddress = createTlsMaterial("127.0.0.2", "IP:127.0.0.2")
    const publicName = createTlsMaterial(publicHost)
    const foreign = createTlsMaterial("127.0.0.1", "IP:127.0.0.1")
    try {
      // An address carries no SNI (RFC 6066), and leaving the server name out
      // altogether is not the same thing: Node would then fill it from the rewritten
      // Host header and check this certificate under the public name. The upstream
      // must see no name asked for, and its address certificate must still be
      // accepted even though the public origin is something else entirely.
      const accepted = await tlsAttempt(trusted, trusted.caPath, { host: "127.0.0.1" })
      assert.equal(accepted.response.status, 200)
      assert.deepEqual(json(accepted.response), { tls: true })
      assert.deepEqual(accepted.serverNames, [false])

      const wrongAddress = await tlsAttempt(otherAddress, otherAddress.caPath, { host: "127.0.0.1" })
      assert.equal(wrongAddress.response.status, 502)
      assert.deepEqual(json(wrongAddress.response), { error: "upstream_unavailable" })

      // A certificate for the public name, from a trusted issuer, is exactly what a
      // rewritten Host header would have accepted; the address it was reached at is
      // not in it, so it must be refused.
      const rewrittenName = await tlsAttempt(publicName, publicName.caPath, { host: "127.0.0.1" })
      assert.equal(rewrittenName.response.status, 502)
      assert.deepEqual(json(rewrittenName.response), { error: "upstream_unavailable" })

      const unknownIssuer = await tlsAttempt(foreign, trusted.caPath, { host: "127.0.0.1" })
      assert.equal(unknownIssuer.response.status, 502)
      assert.deepEqual(json(unknownIssuer.response), { error: "upstream_unavailable" })
    } finally {
      trusted.close()
      otherAddress.close()
      publicName.close()
      foreign.close()
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
