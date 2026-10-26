import assert from "node:assert/strict"
import type { IncomingMessage } from "node:http"
import test from "node:test"

import { clientAddress } from "./client-address.ts"
import { parseTrustedProxies } from "./trusted-proxy.ts"

/** The default of compose.prod.yaml: the project network's IPv4 and IPv6 subnets. */
const projectNetwork = parseTrustedProxies("10.93.0.0/24,fd93:1c5e:a7b0::/64")

const fromProxy = (peer: string, forwarded: string): IncomingMessage => ({
  socket: { remoteAddress: peer },
  rawHeaders: ["X-Forwarded-For", forwarded],
}) as unknown as IncomingMessage

void test("the compose default trusts the bundled Caddy over IPv4 and IPv6, and the host gateway", () => {
  // Caddy over either family, an IPv6 visitor forwarded by Docker with its real address.
  assert.deepEqual(clientAddress(fromProxy("fd93:1c5e:a7b0::3", "2001:db8::7"), projectNetwork), { kind: "client", address: "2001:db8::7" })
  assert.deepEqual(clientAddress(fromProxy("10.93.0.3", "2001:db8::7"), projectNetwork), { kind: "client", address: "2001:db8::7" })
  // A proxy on the host comes in through the gateway; nginx overwrites with $remote_addr.
  assert.deepEqual(clientAddress(fromProxy("10.93.0.1", "203.0.113.9"), projectNetwork), { kind: "client", address: "203.0.113.9" })
  // Without ip6tables Docker hands Caddy its IPv6 visitors from the gateway: every hop is
  // the network's own, so the key falls back to Caddy, the shared bucket (documented).
  assert.deepEqual(clientAddress(fromProxy("10.93.0.3", "fd93:1c5e:a7b0::1"), projectNetwork), { kind: "client", address: "10.93.0.3" })
  // Outside the network nobody is trusted.
  assert.deepEqual(clientAddress(fromProxy("10.93.1.3", "203.0.113.9"), projectNetwork), { kind: "client", address: "10.93.1.3" })
})
