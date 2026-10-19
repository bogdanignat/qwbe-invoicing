import assert from "node:assert/strict"
import test from "node:test"

import { edgeRequest, rawExchange, type EdgeCall, type EdgeReply } from "./edge-transport.test-support.ts"
import { publicHost, publicOrigin, startEdgeServer } from "./edge-server.test-support.ts"
import { contentSecurityPolicy } from "./security-headers.ts"

const docsPolicy = "default-src 'none'; script-src 'unsafe-inline'"

const assertSecured = (reply: EdgeReply, what: string, csp = contentSecurityPolicy): void => {
  assert.equal(reply.headers["content-security-policy"], csp, what)
  assert.equal(reply.headers["cross-origin-opener-policy"], "same-origin", what)
  assert.equal(reply.headers["permissions-policy"], "camera=(), microphone=(), geolocation=()", what)
  assert.equal(reply.headers["referrer-policy"], "no-referrer", what)
  assert.equal(reply.headers["x-content-type-options"], "nosniff", what)
}

void test("every answer the kernel writes carries the security headers, errors and the docs redirect included", async () => {
  let ready = true
  let failApi = false
  const server = await startEdgeServer({
    isReady: () => Promise.resolve(ready),
    handle: (request) => {
      if (failApi) return Promise.reject(new Error("simulated handler defect"))
      const status = new URL(request.url).pathname === "/api/session" && request.method === "POST" ? 401 : 200
      // A handler cannot weaken the edge: its own policy headers are overwritten.
      return Promise.resolve(Response.json({ status }, { status, headers: { "referrer-policy": "unsafe-url", "cache-control": "public" } }))
    },
    renderApiDocs: () => Promise.resolve({ status: 200, body: new TextEncoder().encode("<html></html>"),
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": docsPolicy } }),
  })
  const call = (request: EdgeCall) => edgeRequest(server.port, { ...request, headers: { host: publicHost, ...request.headers } })
  const unsafe = { origin: publicOrigin, "content-type": "application/json" }
  try {
    const answers: Array<readonly [string, number, EdgeCall]> = [
      ["api", 200, { path: "/api/customers" }],
      ["health", 200, { path: "/health/live" }],
      ["docs redirect", 303, { path: "/api" }],
      ["invalid target", 400, { path: "/api/%2e%2e/x" }],
      ["origin", 403, { method: "POST", path: "/api/customers", body: "{}" }],
      ["not found", 404, { path: "/nothing-here" }],
      ["method", 405, { method: "POST", path: "/", headers: unsafe, body: "{}" }],
      ["too large", 413, { method: "POST", path: "/api/customers", headers: unsafe, body: "x".repeat(1_000_001) }],
    ]
    for (const [what, status, request] of answers) {
      const reply = await call(request)
      assert.equal(reply.status, status, what)
      assertSecured(reply, what)
    }
    assert.equal((await call({ path: "/api/customers" })).headers["cache-control"], "no-store")

    let throttled: EdgeReply | undefined
    for (let attempt = 0; attempt < 10 && throttled === undefined; attempt += 1) {
      const reply = await call({ method: "POST", path: "/api/session", headers: unsafe, body: "{}" })
      if (reply.status === 429) throttled = reply
    }
    assert.ok(throttled, "the login throttle must answer 429")
    assertSecured(throttled, "throttled")

    failApi = true
    const failed = await call({ path: "/api/customers" })
    assert.equal(failed.status, 500)
    assertSecured(failed, "internal failure")
    ready = false
    const notReady = await call({ path: "/api/customers" })
    assert.equal(notReady.status, 503)
    assertSecured(notReady, "not ready")

    const unparsable = await rawExchange(server.port, ["NOT A REQUEST"])
    assert.equal(unparsable.status, 400)
    assertSecured(unparsable, "unparsable request")
  } finally {
    await server.close()
  }
})

void test("the docs page replaces only the CSP, and only a missing or invalid session becomes a redirect", async () => {
  let ready = true
  const server = await startEdgeServer({
    isReady: () => Promise.resolve(ready),
    renderApiDocs: () => Promise.resolve({ status: 200, body: new TextEncoder().encode("<html></html>"),
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": docsPolicy } }),
  })
  const call = (headers: Readonly<Record<string, string>> = {}) =>
    edgeRequest(server.port, { path: "/api", headers: { host: publicHost, ...headers } })
  try {
    for (const cookie of [undefined, "qwbe_session=not-a-session-id"]) {
      const redirect = await call(cookie === undefined ? {} : { cookie })
      assert.equal(redirect.status, 303)
      assert.equal(redirect.headers.location, "/unlock")
      assert.equal(redirect.headers["cache-control"], "no-store")
      assert.match(String(redirect.headers["set-cookie"]), /^qwbe_session=; Path=\/api; HttpOnly; SameSite=Strict; Secure; /u)
      assert.equal(redirect.body, "")
      assertSecured(redirect, "docs redirect")
    }
    // A session id the store has to look up reaches the (absent) database: a
    // failure there stays a 500, never a redirect.
    const failed = await call({ cookie: `qwbe_session=${"a".repeat(43)}` })
    assert.equal(failed.status, 500)
    assertSecured(failed, "docs failure")
    assert.equal((await call({ cookie: "qwbe_session=" })).status, 400)
    ready = false
    const notReady = await call()
    assert.equal(notReady.status, 503)
    assertSecured(notReady, "docs not ready")
  } finally {
    await server.close()
  }
})
