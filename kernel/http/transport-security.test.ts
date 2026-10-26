import assert from "node:assert/strict"
import test from "node:test"

import { edgeRequest, rawExchange, type EdgeCall } from "./edge-transport.test-support.ts"
import { publicHost, startEdgeServer } from "./edge-server.test-support.ts"
import { transportSecurityHeaders } from "./security-headers.ts"

const hsts = "max-age=31536000"

const answers: ReadonlyArray<readonly [string, number, EdgeCall]> = [
  ["api", 200, { path: "/api/customers" }],
  ["health", 200, { path: "/health/live" }],
  ["invalid target", 400, { path: "/api/%2e%2e/x" }],
  ["not found", 404, { path: "/health/nothing-here" }],
  ["no UI built", 503, { path: "/invoices" }],
]

void test("HSTS is decided by the scheme of PUBLIC_ORIGIN alone", () => {
  assert.deepEqual(transportSecurityHeaders("https://invoice.example.com"), { "strict-transport-security": hsts })
  for (const origin of ["http://invoice.example.com", "http://127.0.0.1:3000", undefined]) {
    assert.deepEqual(transportSecurityHeaders(origin), {}, String(origin))
  }
})

void test("on an https origin every answer carries HSTS, Node's own parse errors included", async () => {
  const server = await startEdgeServer({ config: { publicOrigin: `https://${publicHost}` } })
  try {
    for (const [what, status, call] of answers) {
      const reply = await edgeRequest(server.port, { ...call, headers: { host: publicHost } })
      assert.equal(reply.status, status, what)
      assert.equal(reply.headers["strict-transport-security"], hsts, what)
    }
    const unparsable = await rawExchange(server.port, ["NOT A REQUEST"])
    assert.equal(unparsable.status, 400)
    assert.equal(unparsable.headers["strict-transport-security"], hsts)
  } finally {
    await server.close()
  }
})

void test("on an http origin no answer carries HSTS", async () => {
  const server = await startEdgeServer({ config: { publicOrigin: `http://${publicHost}` } })
  try {
    for (const [what, status, call] of answers) {
      const reply = await edgeRequest(server.port, { ...call, headers: { host: publicHost } })
      assert.equal(reply.status, status, what)
      assert.equal(reply.headers["strict-transport-security"], undefined, what)
    }
    const unparsable = await rawExchange(server.port, ["NOT A REQUEST"])
    assert.equal(unparsable.status, 400)
    assert.equal(unparsable.headers["strict-transport-security"], undefined)
  } finally {
    await server.close()
  }
})
