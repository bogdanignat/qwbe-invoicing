import assert from "node:assert/strict"
import test from "node:test"

import { edgeRequest, rawExchange, type EdgeCall, type EdgeReply } from "./edge-transport.test-support.ts"
import { edgeToken, publicHost, publicOrigin, startEdgeServer, type EdgeServer } from "./edge-server.test-support.ts"

/**
 * The edge guard over a real socket: every refusal is answered before the API
 * handler sees the request (`seen` stays empty), and every one is a 400 or 403
 * with a stable error code.
 */
const call = (server: EdgeServer, request: EdgeCall): Promise<EdgeReply> =>
  edgeRequest(server.port, { ...request, headers: { host: publicHost, ...request.headers } })

const refused = (reply: EdgeReply, status: number, error: string): void => {
  assert.equal(reply.status, status, reply.body)
  assert.deepEqual(JSON.parse(reply.body), { error })
}

const withServer = async (run: (server: EdgeServer) => Promise<void>, bearerApi = false): Promise<void> => {
  const server = await startEdgeServer({ config: { bearerApi } })
  try {
    await run(server)
  } finally {
    await server.close()
  }
}

void test("Host and X-Forwarded-Host/Proto are pinned to PUBLIC_ORIGIN outside the health paths", async () => {
  await withServer(async (server) => {
    refused(await call(server, { path: "/api/customers", headers: { host: "evil.test" } }), 400, "invalid_host")
    refused(await call(server, { path: "/", headers: { host: `127.0.0.1:${String(server.port)}` } }), 400, "invalid_host")
    refused(await call(server, { path: "/api", headers: { host: "invoice.test:443" } }), 400, "invalid_host")
    for (const [name, value] of [["x-forwarded-host", "evil.test"], ["x-forwarded-host", "invoice.test, evil.test"],
      ["x-forwarded-proto", "http"], ["x-forwarded-proto", "https,https"]] as const) {
      refused(await call(server, { path: "/api/customers", headers: { [name]: value } }), 400, "invalid_forwarded_headers")
    }
    const missingHost = await rawExchange(server.port, ["GET /api/customers HTTP/1.0"])
    assert.equal(missingHost.status, 400)
    assert.equal(server.seen.length, 0)
    const proxied = await call(server, { path: "/api/customers", headers: { "x-forwarded-host": publicHost, "x-forwarded-proto": "https" } })
    assert.equal(proxied.status, 200)
    assert.equal(server.seen[0]?.url, `${publicOrigin}/api/customers`)
  })
})

void test("the Docker healthcheck reaches liveness and readiness on the internal address", async () => {
  await withServer(async (server) => {
    const internal = { host: `127.0.0.1:${String(server.port)}` }
    for (const path of ["/health/live", "/healthz", "/health/ready"]) {
      assert.equal((await call(server, { path, headers: internal })).status, 200, path)
    }
    assert.deepEqual(JSON.parse((await call(server, { path: "/healthz", headers: internal })).body), { status: "live" })
    // Exempt from pinning, not from the target check: a traversal that a URL
    // parser would turn into a health path is refused, never classified.
    for (const path of ["/api/../health/live", "/api/%2e%2e/health/live", "/x/%252e%252e/healthz", "//health/live"]) {
      refused(await call(server, { path, headers: internal }), 400, "invalid_request_target")
    }
  })
})

void test("duplicate identity headers are refused on the raw transport, whichever copy is valid", async () => {
  await withServer(async (server) => {
    const cookie = `qwbe_session=${"a".repeat(43)}`
    for (const duplicate of [
      [`Host: ${publicHost}`, "Host: evil.test"],
      [`Host: ${publicHost}`, `Host: ${publicHost}`],
      [`Host: ${publicHost}`, `Origin: ${publicOrigin}`, "Origin: https://evil.test"],
      [`Host: ${publicHost}`, `X-Forwarded-Host: ${publicHost}`, `X-Forwarded-Host: ${publicHost}`],
      [`Host: ${publicHost}`, "X-Forwarded-Proto: https", "X-Forwarded-Proto: https"],
      [`Host: ${publicHost}`, `Cookie: ${cookie}`, "Cookie: other=1"],
      [`Host: ${publicHost}`, "Authorization: Bearer a", "Authorization: Bearer b"],
    ]) {
      const reply = await rawExchange(server.port, ["GET /api/customers HTTP/1.1", ...duplicate])
      refused(reply, 400, "duplicate_header")
    }
    assert.equal(server.seen.length, 0)
  })
})

void test("Authorization is refused on the public listener unless the Bearer API is switched on", async () => {
  await withServer(async (server) => {
    for (const authorization of [`Bearer ${edgeToken}`, "Basic abc"]) {
      refused(await call(server, { path: "/api/customers", headers: { authorization } }), 400, "authorization_not_allowed")
    }
    const empty = await rawExchange(server.port, ["GET /api/customers HTTP/1.1", `Host: ${publicHost}`, "Authorization:"])
    refused(empty, 400, "authorization_not_allowed")
    refused(await call(server, { path: "/api", headers: { authorization: `Bearer ${edgeToken}` } }), 400, "authorization_not_allowed")
    assert.equal(server.seen.length, 0)
  })
})

void test("with QWBE_BEARER_API=on, Bearer works, mixed credentials are refused and mutations still need Origin", async () => {
  await withServer(async (server) => {
    const authorization = `Bearer ${edgeToken}`
    assert.equal((await call(server, { path: "/api/customers", headers: { authorization } })).status, 200)
    refused(await call(server, { path: "/api/customers", headers: { authorization, cookie: `qwbe_session=${"a".repeat(43)}` } }),
      400, "mixed_credentials")
    refused(await call(server, { path: "/api/customers", headers: { authorization, cookie: "qwbe_session=" } }),
      400, "mixed_credentials")
    refused(await call(server, { method: "POST", path: "/api/customers", headers: { authorization }, body: "{}" }),
      403, "origin_not_allowed")
    const allowed = await call(server, { method: "POST", path: "/api/customers", headers: { authorization, origin: publicOrigin }, body: "{}" })
    assert.equal(allowed.status, 200)
    assert.equal(server.seen.length, 2)
  }, true)
})

void test("an empty or repeated session cookie is refused before any session is looked up", async () => {
  await withServer(async (server) => {
    const valid = `qwbe_session=${"a".repeat(43)}`
    for (const cookie of ["qwbe_session=", "qwbe_session", `qwbe_session=; ${valid}`, `${valid}; qwbe_session=${"b".repeat(43)}`,
      `${valid}, qwbe_session=`]) {
      refused(await call(server, { path: "/api/session", headers: { cookie } }), 400, "invalid_session_cookie")
    }
    assert.equal(server.seen.length, 0)
  })
})

void test("every unsafe method needs the exact public Origin: login, unknown routes and the root alike", async () => {
  await withServer(async (server) => {
    for (const [method, path] of [["POST", "/api/session"], ["DELETE", "/api/session"], ["PUT", "/api/issuer"],
      ["PATCH", "/api/customers/1"], ["POST", "/api/does-not-exist"], ["POST", "/"]] as const) {
      for (const origin of [undefined, "null", "https://evil.test", "http://invoice.test", `${publicOrigin}/`]) {
        const headers = origin === undefined ? {} : { origin }
        refused(await call(server, { method, path, headers, body: "{}" }), 403, "origin_not_allowed")
      }
    }
    assert.equal(server.seen.length, 0)
    assert.equal((await call(server, { method: "POST", path: "/api/session", headers: { origin: publicOrigin }, body: "{}" })).status, 200)
  })
})
