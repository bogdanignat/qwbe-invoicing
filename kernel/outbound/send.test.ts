import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import test from "node:test"

import { Effect } from "effect"

import { failureOf, fakeTransport, oversizedBody, stalledBody } from "../company-lookup/transport.test-support.ts"
import { SendFailure, send, type Transport } from "./send.ts"

const options = (transport: Transport) => ({ transport, timeoutMs: 300, maxBodyBytes: 64 * 1024, decode: "utf8" as const })
const reason = async (transport: Transport, decode: "utf8" | "bytes" = "utf8") => {
  const { failure, printed } = await failureOf(send({ ...options(transport), decode }, "https://api.anaf.ro/test/FCTEL/rest/x", { method: "POST" }))
  assert.ok(failure instanceof SendFailure)
  assert.equal(printed.includes("Bearer secret-token"), false, "nothing of the cause travels on")
  return failure.reason
}
// Whatever a transport rejects with, an Error or not, is classified the same way.
const failing = (error: unknown): Transport => () => Promise.resolve().then(() => { throw error })
const coded = (code: string) => Object.assign(new TypeError("fetch failed: Bearer secret-token"), { cause: Object.assign(new Error(`connect ${code}`), { code }) })

void test("an answer is returned with any status, decoded as strict UTF-8 or kept as exact bytes", async () => {
  const { transport, sent } = fakeTransport(() => new Response("înregistrată", { status: 500 }))
  const text = await Effect.runPromise(send(options(transport), "https://api.anaf.ro/x", { method: "GET" }))
  assert.deepEqual([text.status, text.body], [500, "înregistrată"])
  assert.equal(sent[0]?.redirect, "manual", "a redirect is never followed")
  const raw = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00])
  const bytes = await Effect.runPromise(send({ ...options(fakeTransport(() => new Response(raw)).transport), decode: "bytes" }, "https://api.anaf.ro/x", {}))
  assert.equal(Buffer.compare(Buffer.from(bytes.body), Buffer.from(raw)), 0)
})

void test("a connection that never opened is not_sent: name resolution, refusal, unreachable network, TLS", async () => {
  for (const code of ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED"]) {
    assert.equal(await reason(failing(coded(code))), "not_sent", code)
  }
  const closed = createServer()
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve))
  const { port } = closed.address() as AddressInfo
  await new Promise<void>((resolve) => closed.close(() => { resolve() }))
  assert.equal(await reason(() => fetch(`http://127.0.0.1:${String(port)}/`)), "not_sent", "a real refused connection")
})

void test("everything that may have reached the provider is ambiguous", async () => {
  for (const code of ["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "ETIMEDOUT"]) assert.equal(await reason(failing(coded(code))), "ambiguous", code)
  assert.equal(await reason(failing(new Error("Bearer secret-token"))), "ambiguous", "an error with no code")
  assert.equal(await reason(failing("not even an error")), "ambiguous")
  assert.equal(await reason(() => new Promise(() => {})), "ambiguous", "no answer before the timeout")
  assert.equal(await reason(() => Promise.resolve(stalledBody())), "ambiguous", "a body that never ends")
  assert.equal(await reason(() => Promise.resolve(new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }))), "ambiguous")
  assert.equal(await reason(() => Promise.resolve(new Response("{}", { headers: { "content-length": String(64 * 1024 + 1) } }))), "ambiguous")
  assert.equal(await reason(() => Promise.resolve(oversizedBody(64 * 1024 + 1))), "ambiguous", "streamed past the limit")
  assert.equal(await reason(() => Promise.resolve(new Response(new Uint8Array([0xc3, 0x28])))), "ambiguous", "invalid UTF-8")
  assert.equal(await reason(() => Promise.resolve(oversizedBody(64 * 1024 + 1)), "bytes"), "ambiguous", "bytes are bounded the same way")
})
