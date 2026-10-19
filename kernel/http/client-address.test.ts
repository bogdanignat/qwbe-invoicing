import assert from "node:assert/strict"
import type { IncomingMessage } from "node:http"
import test from "node:test"

import { clientAddress } from "./client-address.ts"
import { edgeRequest } from "./edge-transport.test-support.ts"
import { publicHost, publicOrigin, startEdgeServer } from "./edge-server.test-support.ts"
import { parseTrustedProxies } from "./trusted-proxy.ts"

const request = (remoteAddress: string, ...forwarded: ReadonlyArray<string>): IncomingMessage => ({
  socket: { remoteAddress },
  rawHeaders: forwarded.flatMap((value) => ["X-Forwarded-For", value]),
}) as unknown as IncomingMessage

const proxies = parseTrustedProxies("10.0.0.5, 172.18.0.0/16, fd00::/8")

void test("QWBE_TRUSTED_PROXY accepts addresses and ranges, trusts nothing by default and refuses what it cannot read", () => {
  assert.equal(parseTrustedProxies(undefined).trusts("127.0.0.1"), false)
  assert.equal(parseTrustedProxies("").trusts("127.0.0.1"), false)
  assert.equal(proxies.trusts("10.0.0.5"), true)
  assert.equal(proxies.trusts("::ffff:10.0.0.5"), true)
  assert.equal(proxies.trusts("172.18.200.1"), true)
  assert.equal(proxies.trusts("fd00::1"), true)
  assert.equal(proxies.trusts("10.0.0.6"), false)
  assert.equal(proxies.trusts("not-an-address"), false)
  for (const value of ["10.0.0", "10.0.0.0/33", "fd00::/129", "0.0.0.0/0", "::/0", "10.0.0.0/x", "10.0.0.0/8/1", "proxy.local"]) {
    assert.throws(() => parseTrustedProxies(value), /QWBE_TRUSTED_PROXY entries must be/u, value)
  }
})

void test("a client that is not a trusted proxy keeps its socket address, whatever it forwards", () => {
  assert.deepEqual(clientAddress(request("198.51.100.7", "203.0.113.9"), proxies), { kind: "client", address: "198.51.100.7" })
  // Not even a repeated or malformed header from an untrusted peer changes anything.
  assert.deepEqual(clientAddress(request("198.51.100.7", "x", "y"), proxies), { kind: "client", address: "198.51.100.7" })
  assert.deepEqual(clientAddress(request("198.51.100.7", "203.0.113.9"), parseTrustedProxies(undefined)),
    { kind: "client", address: "198.51.100.7" })
})

void test("behind trusted proxies the client is the right-most forwarded address that is not a proxy", () => {
  assert.deepEqual(clientAddress(request("10.0.0.5", "203.0.113.9"), proxies), { kind: "client", address: "203.0.113.9" })
  // Multi-hop: the client's own (forgeable) entries sit to the left and are ignored.
  assert.deepEqual(clientAddress(request("10.0.0.5", "1.2.3.4, 203.0.113.9, 172.18.0.7"), proxies),
    { kind: "client", address: "203.0.113.9" })
  assert.deepEqual(clientAddress(request("::ffff:10.0.0.5", "::ffff:203.0.113.9"), proxies), { kind: "client", address: "203.0.113.9" })
  // Every hop trusted: the left-most is only what the sender wrote, and inside a
  // trusted range it could change on every request, so the proxy is the key.
  assert.deepEqual(clientAddress(request("10.0.0.5", "172.18.0.9, 172.18.0.7"), proxies), { kind: "client", address: "10.0.0.5" })
  assert.deepEqual(clientAddress(request("10.0.0.5", "172.18.3.4"), proxies), { kind: "client", address: "10.0.0.5" })
  // No header: the proxy itself, the shared and therefore stricter bucket.
  assert.deepEqual(clientAddress(request("10.0.0.5"), proxies), { kind: "client", address: "10.0.0.5" })
})

void test("a repeated or malformed X-Forwarded-For from a trusted proxy is refused", () => {
  for (const forwarded of [["203.0.113.9", "198.51.100.7"], [""], ["203.0.113.9,"], ["203.0.113.9:443"], ["unknown"], ["203.0.113.9 198.51.100.7"]]) {
    assert.deepEqual(clientAddress(request("10.0.0.5", ...forwarded), proxies), { kind: "invalid" }, JSON.stringify(forwarded))
  }
})

void test("over the socket: the forwarded client keys the login throttle and a duplicate header answers 400", async () => {
  const server = await startEdgeServer({
    config: { trustedProxies: parseTrustedProxies("127.0.0.1") },
    handle: () => Promise.resolve(Response.json({ error: "invalid_credentials" }, { status: 401 })),
  })
  const login = (forwardedFor?: string) => edgeRequest(server.port, { method: "POST", path: "/api/session", body: "{}",
    headers: { host: publicHost, origin: publicOrigin, ...(forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor }) } })
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) assert.equal((await login("203.0.113.9")).status, 401)
    assert.equal((await login("203.0.113.9")).status, 429)
    // A forged left-most entry does not escape the cooldown of the real client.
    assert.equal((await login("192.0.2.1, 203.0.113.9")).status, 429)
    // Another client behind the same proxy is not locked out.
    assert.equal((await login("198.51.100.7")).status, 401)
    const duplicate = await edgeRequest(server.port, { method: "POST", path: "/api/session", body: "{}",
      headers: { host: publicHost, origin: publicOrigin, "x-forwarded-for": ["198.51.100.7", "198.51.100.8"] as unknown as string } })
    assert.equal(duplicate.status, 400)
    assert.deepEqual(JSON.parse(duplicate.body), { error: "invalid_forwarded_for" })
  } finally {
    await server.close()
  }
})
