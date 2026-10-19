import assert from "node:assert/strict"
import { after, afterEach, before, describe, test } from "node:test"
import { URL } from "node:url"

import { exchange, startKernel } from "./app-runtime-fixture.mjs"
import { assertEdgeHeaders, json, productionEnvironment, proxied, publicOrigin, refused, sessionCookie } from "./app-runtime-expect.mjs"

/**
 * The real kernel over HTTP: `migrate` and `serve` from the CLI entrypoint, the
 * real Vite build, the verifier's PostgreSQL. It runs after `pnpm build:frontend`
 * in `pnpm verify` (`pnpm test:app:runtime`), with `app-runtime-session.mjs`.
 * This file: the SPA and the edge, before any session exists.
 */

void describe("production kernel: SPA and edge", { timeout: 120_000 }, () => {
  let kernel
  const send = (options) => exchange(kernel.port, { ...options, headers: { ...proxied, ...options.headers } })
  before(async () => { kernel = await startKernel("app_runtime_edge", productionEnvironment) })
  afterEach((t) => { if (!t.passed) console.error(kernel?.output()) })
  after(async () => { await kernel?.close() })

  void test("index, hashed assets, deep link and missing asset", async () => {
    const index = await send({ path: "/" })
    assert.equal(index.status, 200)
    assert.match(index.headers["content-type"], /^text\/html/u)
    assert.equal(index.headers["cache-control"], "no-store")
    assert.match(index.body, /<div id="root"><\/div>/u)
    assertEdgeHeaders(index, "index")
    const assets = [...index.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/gu)].map((match) => match[1])
    assert.ok(assets.some((path) => path.endsWith(".js")) && assets.some((path) => path.endsWith(".css")), assets.join(", "))
    for (const path of assets) {
      const asset = await send({ path })
      assert.equal(asset.status, 200, path)
      assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable", path)
      if (path.endsWith(".js")) assert.equal(asset.headers["content-type"], "text/javascript; charset=utf-8", path)
      assertEdgeHeaders(asset, path)
    }
    const deepLink = await send({ path: "/invoices/runtime-deep-link?tab=plati" })
    assert.deepEqual([deepLink.status, deepLink.body], [200, index.body], "deep link falls back to index.html")
    assertEdgeHeaders(deepLink, "deep link")
    refused(await send({ path: "/assets/missing-runtime0.js" }), 404, "not_found", "missing asset")
  })

  void test("Swagger without a session goes to the unlock screen", async () => {
    const docs = await send({ path: "/api" })
    assert.deepEqual([docs.status, docs.headers.location], [303, "/unlock"])
    assertEdgeHeaders(docs, "docs redirect")
  })

  void test("Host, Origin and Authorization are refused before any credential is looked at", async () => {
    const login = { path: "/api/session", method: "POST", body: { token: kernel.token } }
    refused(await send({ path: "/", headers: { host: "foreign.example.test" } }), 400, "invalid_host", "wrong Host")
    refused(await send({ path: "/", headers: { "x-forwarded-host": "foreign.example.test" } }), 400,
      "invalid_forwarded_headers", "wrong X-Forwarded-Host")
    refused(await send({ ...login, headers: { ...json, origin: "https://foreign.example.test" } }), 403, "origin_not_allowed", "wrong Origin")
    refused(await send({ ...login, headers: json }), 403, "origin_not_allowed", "no Origin")
    refused(await send({ path: "/api/customers", headers: { authorization: `Bearer ${kernel.token}` } }), 400,
      "authorization_not_allowed", "Authorization with the Bearer API off")
    const wrongToken = await send({ ...login, body: { token: "x".repeat(43) }, headers: { ...json, origin: publicOrigin } })
    assert.equal(wrongToken.status, 401)
    assertEdgeHeaders(wrongToken, "wrong token")
  })
})

void describe("development kernel on loopback", { timeout: 60_000 }, () => {
  let kernel
  before(async () => { kernel = await startKernel("app_runtime_dev") })
  afterEach((t) => { if (!t.passed) console.error(kernel?.output()) })
  after(async () => { await kernel?.close() })

  void test("the session cookie is not Secure on an http origin", async () => {
    const origin = `http://127.0.0.1:${String(kernel.port)}`
    const opened = await exchange(kernel.port, { path: "/api/session", method: "POST", body: { token: kernel.token },
      headers: { host: new URL(origin).host, origin, ...json } })
    assert.equal(opened.status, 200, JSON.stringify(opened.body))
    const attributes = sessionCookie(opened).split("; ")
    for (const attribute of ["Path=/api", "HttpOnly", "SameSite=Strict"]) assert.ok(attributes.includes(attribute), attribute)
    assert.ok(!attributes.includes("Secure"), attributes.join("; "))
  })
})
