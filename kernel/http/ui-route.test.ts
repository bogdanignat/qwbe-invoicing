import assert from "node:assert/strict"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import { publicHost, publicOrigin, startEdgeServer, type EdgeServer } from "./edge-server.test-support.ts"
import { edgeRequest, rawExchange, type EdgeCall, type EdgeReply } from "./edge-transport.test-support.ts"
import { contentSecurityPolicy } from "./security-headers.ts"
import { fakeIcon, fakeIndex, fakeScript, fakeScriptPath, fakeStyle, fakeStylePath, writeFakeUiDist } from "./ui-dist.test-support.ts"

const immutable = "public, max-age=31536000, immutable"

const withUi = async (body: (server: EdgeServer, directory: string) => Promise<void>, files?: Record<string, string>): Promise<void> => {
  const directory = writeFakeUiDist(files)
  const server = await startEdgeServer({ config: { uiDirectory: directory } })
  try {
    await body(server, directory)
  } finally {
    await server.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

const call = (server: EdgeServer, request: EdgeCall): Promise<EdgeReply> =>
  edgeRequest(server.port, { ...request, headers: { host: publicHost, ...request.headers } })

const assertSecured = (reply: EdgeReply, what: string): void => {
  assert.equal(reply.headers["content-security-policy"], contentSecurityPolicy, what)
  assert.equal(reply.headers["cross-origin-opener-policy"], "same-origin", what)
  assert.equal(reply.headers["referrer-policy"], "no-referrer", what)
  assert.equal(reply.headers["x-content-type-options"], "nosniff", what)
}

const assertIndex = (reply: EdgeReply, what: string): void => {
  assert.equal(reply.status, 200, what)
  assert.equal(reply.body, fakeIndex, what)
  assert.equal(reply.headers["content-type"], "text/html; charset=utf-8", what)
  assert.equal(reply.headers["cache-control"], "no-store", what)
  assert.equal(reply.headers["content-length"], String(Buffer.byteLength(fakeIndex)), what)
  assertSecured(reply, what)
}

void test("/ and every deep link answer index.html, no-store, with the security headers", async () => {
  await withUi(async (server) => {
    for (const path of ["/", "/index.html", "/app", "/unlock", "/invoices/abc", "/invoices/new", "/proformas/new",
      "/proformas/p-1", "/drafts/customer%2F1", "/integrations", "/does/not/exist", "/invoices?status=paid&status=overdue",
      "/assets", "/.vite/manifest.json"]) {
      assertIndex(await call(server, { path }), path)
    }
  })
})

void test("build files answer with their MIME type and length; only hashed assets are immutable", async () => {
  await withUi(async (server) => {
    const expected: ReadonlyArray<readonly [string, string, string, string]> = [
      [fakeScriptPath, fakeScript, "text/javascript; charset=utf-8", immutable],
      [fakeStylePath, fakeStyle, "text/css; charset=utf-8", immutable],
      ["/favicon.svg", fakeIcon, "image/svg+xml", "no-cache"],
      ["/assets/logo@2x-B1x2c3d4.png", "png", "image/png", immutable],
      ["/icon+dark.svg", "svg", "image/svg+xml", "no-cache"],
    ]
    for (const [path, body, contentType, cacheControl] of expected) {
      const reply = await call(server, { path: `${path}?v=1` })
      assert.equal(reply.status, 200, path)
      assert.equal(reply.body, body, path)
      assert.equal(reply.headers["content-type"], contentType, path)
      assert.equal(reply.headers["cache-control"], cacheControl, path)
      assert.equal(reply.headers["content-length"], String(Buffer.byteLength(body)), path)
      assertSecured(reply, path)
    }
  }, { "assets/logo@2x-B1x2c3d4.png": "png", "icon+dark.svg": "svg" })
})

void test("a missing asset is a 404, never index.html", async () => {
  await withUi(async (server) => {
    for (const path of ["/assets/index-AAAAAAAA.js", "/assets/missing.css", "/assets/nested/x.js", "/assets/"]) {
      const reply = await call(server, { path })
      assert.equal(reply.status, 404, path)
      assert.deepEqual(JSON.parse(reply.body), { error: "not_found" }, path)
      assert.equal(reply.headers["cache-control"], "no-store", path)
      assertSecured(reply, path)
    }
  })
})

void test("HEAD answers the GET headers, the real Content-Length included, and no body", async () => {
  await withUi(async (server) => {
    for (const [path, length] of [["/invoices/abc", fakeIndex], [fakeScriptPath, fakeScript]] as const) {
      const reply = await rawExchange(server.port, [`HEAD ${path} HTTP/1.1`, `Host: ${publicHost}`])
      assert.equal(reply.status, 200, path)
      assert.equal(reply.headers["content-length"], String(Buffer.byteLength(length)), path)
      assert.equal(reply.headers["transfer-encoding"], undefined, path)
      assert.equal(reply.body, "", path)
      assertSecured(reply, path)
    }
  })
})

void test("other methods on UI routes are 405, after the Origin guard", async () => {
  await withUi(async (server) => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const reply = await call(server, { method, path: "/invoices", headers: { origin: publicOrigin }, body: "{}" })
      assert.equal(reply.status, 405, method)
      assert.equal(reply.headers.allow, "GET, HEAD", method)
      assertSecured(reply, method)
      assert.equal((await call(server, { method, path: "/invoices", body: "{}" })).status, 403, `${method} without Origin`)
    }
    assert.equal((await call(server, { method: "OPTIONS", path: "/" })).status, 405)
  })
})

void test("the API and the health checks come before the build, even when it has files on their paths", async () => {
  const shadow = { "api/customers": "shadow", "health/live": "shadow", "healthz": "shadow", "API/x": "shadow" }
  await withUi(async (server) => {
    assert.deepEqual(JSON.parse((await call(server, { path: "/api/customers" })).body), { ok: true })
    assert.equal(server.seen.length, 1)
    assert.deepEqual(JSON.parse((await call(server, { path: "/health/live" })).body), { status: "live" })
    assert.equal((await call(server, { path: "/api" })).status, 303)
    for (const path of ["/API/x", "/apix", "/health", "/healthz", "/Health/live"]) {
      const reply = await call(server, { path })
      assert.equal(reply.status, 404, path)
      assert.notEqual(reply.body, fakeIndex, path)
    }
  }, shadow)
})

void test("path traversal never reaches the build: the edge refuses the raw target first", async () => {
  await withUi(async (server) => {
    for (const target of ["/assets/../index.html", "/assets/%2e%2e/index.html", "/assets/%252e%252e/x", "/assets/..%2f..%2fetc%2fpasswd",
      "/assets/.%2e/x", "/assets/..\\x", "/..", "/assets//x", "/%2e%2e/etc/passwd"]) {
      const reply = await rawExchange(server.port, [`GET ${target} HTTP/1.1`, `Host: ${publicHost}`])
      assert.equal(reply.status, 400, target)
      assert.deepEqual(JSON.parse(reply.body), { error: "invalid_request_target" }, target)
      assertSecured(reply, target)
    }
    const wrongHost = await edgeRequest(server.port, { path: "/", headers: { host: "evil.test" } })
    assert.equal(wrongHost.status, 400)
    assert.notEqual(wrongHost.body, fakeIndex)
  })
})

void test("the build is read once at startup: later changes on disk are not served", async () => {
  await withUi(async (server, directory) => {
    writeFileSync(join(directory, "late.js"), "late")
    rmSync(join(directory, "index.html"))
    writeFileSync(join(directory, fakeScriptPath.slice(1)), "changed")
    assertIndex(await call(server, { path: "/late.js" }), "added after startup")
    assertIndex(await call(server, { path: "/" }), "removed after startup")
    assert.equal((await call(server, { path: fakeScriptPath })).body, fakeScript)
  })
})
