import assert from "node:assert/strict"
import { connect } from "node:net"
import test from "node:test"

import { ClientDisconnected, RequestDeadlineExceeded } from "./edge-deadline.ts"
import { edgeRequest, rawExchange } from "./edge-transport.test-support.ts"
import { publicHost, publicOrigin, startEdgeServer, type EdgeServerOptions } from "./edge-server.test-support.ts"
import type { Pool } from "pg"

/**
 * The request deadline at the edge, shortened to 300 ms through the server's
 * own seam. Each case blocks a different stage — the handler, the body, the
 * handler's response stream, readiness, the docs — and expects one 504, the
 * handler's signal aborted, and nothing written after it.
 */
const deadlineMs = 300
const never = <Value>(): Promise<Value> => new Promise<Value>(() => {})
const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

const withDeadline = async (options: EdgeServerOptions, run: (port: number, seen: ReadonlyArray<Request>) => Promise<void>) => {
  const server = await startEdgeServer({ ...options, dependencies: { requestDeadlineMs: deadlineMs } })
  try {
    await run(server.port, server.seen)
  } finally {
    server.server.closeAllConnections()
    await server.close()
  }
}

const timedOut = async (reply: Promise<{ readonly status: number; readonly body: string }>, what: string) => {
  const started = Date.now()
  const { status, body } = await reply
  assert.equal(status, 504, what)
  assert.deepEqual(JSON.parse(body), { error: "upstream_timeout" }, what)
  assert.ok(Date.now() - started < deadlineMs + 2_000, `${what} answered late`)
}

void test("a blocked handler is answered 504 once and its request signal is aborted", async () => {
  await withDeadline({ handle: () => never() }, async (port, seen) => {
    // The raw socket reads until the server closes it: exactly one response.
    const reply = await rawExchange(port, ["GET /api/customers HTTP/1.1", `Host: ${publicHost}`])
    assert.equal(reply.status, 504)
    assert.equal(reply.headers.connection, "close")
    assert.equal(seen.length, 1)
    const [handled] = seen
    assert.ok(handled)
    assert.equal(handled.signal.aborted, true)
    assert.ok(handled.signal.reason instanceof RequestDeadlineExceeded)
  })
})

void test("a handler that answers after the deadline does not write a second response", async () => {
  let release!: () => void
  const late = new Promise<void>((resolve) => { release = resolve })
  await withDeadline({ handle: async () => { await late; return Response.json({ late: true }) } }, async (port) => {
    const reply = await rawExchange(port, ["GET /api/customers HTTP/1.1", `Host: ${publicHost}`])
    release()
    await sleep(50)
    assert.equal(reply.status, 504)
    assert.equal(reply.body.includes("late"), false)
    assert.equal((await edgeRequest(port, { path: "/health/live" })).status, 200, "the server keeps serving")
  })
})

void test("a response body that never finishes is cut at the deadline", async () => {
  const stalled = () => Promise.resolve(new Response(new ReadableStream({ start: () => {} }), { status: 200 }))
  await withDeadline({ handle: stalled }, async (port) => {
    await timedOut(edgeRequest(port, { path: "/api/customers", headers: { host: publicHost } }), "stalled body")
  })
})

void test("a slow upload is answered 504 without the handler ever seeing it", async () => {
  await withDeadline({}, async (port, seen) => {
    const reply = new Promise<{ status: number; body: string }>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1")
      let received = ""
      socket.setEncoding("utf8")
      socket.on("data", (chunk: string) => { received += chunk })
      socket.once("error", reject)
      socket.once("close", () => {
        resolve({ status: Number(received.split(" ")[1]), body: received.slice(received.indexOf("{"), received.lastIndexOf("}") + 1) })
      })
      socket.write([`POST /api/customers HTTP/1.1`, `Host: ${publicHost}`, `Origin: ${publicOrigin}`,
        "Content-Type: application/json", "Content-Length: 1000", "", "{"].join("\r\n"))
    })
    await timedOut(reply, "slow upload")
    assert.equal(seen.length, 0)
  })
})

void test("blocked readiness and a blocked session read on the docs page are bounded by the same deadline", async () => {
  await withDeadline({ isReady: () => never() }, async (port) => {
    await timedOut(edgeRequest(port, { path: "/health/ready" }), "readiness")
    await timedOut(edgeRequest(port, { path: "/api/customers", headers: { host: publicHost } }), "api readiness")
    await timedOut(edgeRequest(port, { path: "/api", headers: { host: publicHost } }), "docs readiness")
  })
  const stuckPool = { connect: () => never() } as unknown as Pool
  await withDeadline({ pool: stuckPool }, async (port) => {
    const cookie = `qwbe_session=${"a".repeat(43)}`
    await timedOut(edgeRequest(port, { path: "/api", headers: { host: publicHost, cookie } }), "docs session read")
  })
})

void test("a client that disconnects aborts the handler and nothing is written to the closed socket", async () => {
  let reached!: () => void
  const handlerReached = new Promise<void>((resolve) => { reached = resolve })
  await withDeadline({ handle: () => { reached(); return never() } }, async (port, seen) => {
    const socket = connect(port, "127.0.0.1")
    socket.on("error", () => {})
    socket.write(["GET /api/customers HTTP/1.1", `Host: ${publicHost}`, "", ""].join("\r\n"))
    await handlerReached
    socket.destroy()
    await sleep(100)
    const [handled] = seen
    assert.ok(handled)
    assert.equal(handled.signal.aborted, true)
    assert.ok(handled.signal.reason instanceof ClientDisconnected)
    // The deadline passing afterwards must not throw or write anywhere.
    await sleep(deadlineMs)
    assert.equal((await edgeRequest(port, { path: "/health/live" })).status, 200)
  })
})
