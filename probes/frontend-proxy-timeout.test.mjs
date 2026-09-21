import assert from "node:assert/strict"
import { createServer } from "node:http"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { URL } from "node:url"

import { maximumRequestBodyBytes } from "../frontend/src/lib/server/proxy-body.ts"
import { handleProxyRequest } from "../frontend/src/lib/server/proxy.ts"
import { close, frontendOrigin, listen, proxyRequest } from "./frontend-proxy-fixture.mjs"

void test("chunked oversized bodies stop locally before an upstream attempt", async () => {
  let attempts = 0
  const upstream = createServer((_request, response) => { attempts += 1; response.end("unexpected") })
  const origin = await listen(upstream)
  try {
    const stream = new globalThis.ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(maximumRequestBodyBytes)); controller.enqueue(new Uint8Array(1)); controller.close()
    } })
    const request = proxyRequest("customers", { method: "POST", headers: { origin: frontendOrigin }, body: stream, duplex: "half" })
    const response = await handleProxyRequest(request, {
      frontendOrigin: new URL(frontendOrigin), upstreamBase: new URL(origin), timeoutMs: 1_000,
    })
    assert.equal(response.status, 413)
    assert.equal(attempts, 0)
  } finally { await close(upstream) }
})

void test("deadline and abort close upstream streams before and after headers", async () => {
  const sockets = new Set()
  const upstream = createServer((request, response) => {
    if (request.url === "/api/headers-late") return
    if (request.method === "HEAD") { response.writeHead(200); response.end(); return }
    if (request.url === "/api/no-content") { response.writeHead(204); response.end(); return }
    if (request.url === "/api/not-modified") { response.writeHead(304); response.end(); return }
    response.writeHead(200, { "content-type": "application/octet-stream" })
    response.write(new Uint8Array([1, 2, 3]))
  })
  upstream.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)) })
  const origin = await listen(upstream)
  const config = { frontendOrigin: new URL(frontendOrigin), upstreamBase: new URL(origin), timeoutMs: 30 }
  try {
    const preheaders = await handleProxyRequest(proxyRequest("headers-late"), config)
    assert.equal(preheaders.status, 504)
    const beforeHeadersController = new globalThis.AbortController()
    const beforeHeadersPromise = handleProxyRequest(proxyRequest("headers-late", { signal: beforeHeadersController.signal }), {
      ...config, timeoutMs: 1_000,
    })
    beforeHeadersController.abort()
    assert.equal((await beforeHeadersPromise).status, 502)
    for (const [path, method, status] of [["head", "HEAD", 200], ["no-content", "GET", 204], ["not-modified", "GET", 304]]) {
      const response = await handleProxyRequest(proxyRequest(path, { method }), { ...config, timeoutMs: 1_000 })
      assert.equal(response.status, status)
      assert.equal(response.body, null)
    }
    const streaming = await handleProxyRequest(proxyRequest("streaming"), config)
    assert.equal(streaming.status, 200)
    await assert.rejects(streaming.arrayBuffer())
    await delay(20)
    assert.equal(sockets.size, 0)
    const cancelled = await handleProxyRequest(proxyRequest("streaming"), { ...config, timeoutMs: 1_000 })
    assert.equal(cancelled.status, 200)
    await cancelled.body.cancel()
    await delay(20)
    assert.equal(sockets.size, 0)
    const controller = new globalThis.AbortController()
    const aborted = await handleProxyRequest(proxyRequest("streaming", { signal: controller.signal }), {
      ...config, timeoutMs: 1_000,
    })
    assert.equal(aborted.status, 200)
    controller.abort()
    await assert.rejects(aborted.arrayBuffer())
    await delay(20)
    assert.equal(sockets.size, 0)
  } finally {
    for (const socket of sockets) socket.destroy()
    await close(upstream)
  }
})
