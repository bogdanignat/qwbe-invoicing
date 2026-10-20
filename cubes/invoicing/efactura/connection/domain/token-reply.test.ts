import assert from "node:assert/strict"
import test from "node:test"

import { Redacted } from "effect"

import { classifyTokenReply } from "./token-reply.ts"

const body = (value: unknown) => JSON.stringify(value)
const pair = { access_token: "eyJ.access", refresh_token: "eyJ.refresh", token_type: "Bearer", expires_in: 7_776_000 }

void test("a complete pair is a grant, and the tokens come out redacted", () => {
  const reply = classifyTokenReply(200, body(pair))
  assert.ok(reply.kind === "granted")
  assert.equal(Redacted.value(reply.grant.accessToken), "eyJ.access")
  assert.equal(Redacted.value(reply.grant.refreshToken), "eyJ.refresh")
  assert.equal(reply.grant.accessExpiresInSeconds, 7_776_000)
  assert.equal(JSON.stringify(reply).includes("eyJ"), false, "printing the reply does not print a token")
})

void test("a refused grant is told apart from a refused client and from everything else", () => {
  assert.deepEqual(classifyTokenReply(400, body({ error: "invalid_grant", error_description: "expired" })), { kind: "invalid_grant" })
  assert.deepEqual(classifyTokenReply(401, body({ error: "invalid_client" })), { kind: "client_refused" })
  assert.deepEqual(classifyTokenReply(403, ""), { kind: "client_refused" })
  for (const [status, text] of [
    [400, body({ error: "invalid_request" })], [500, body(pair)], [302, ""], [200, "<html>"], [200, body([pair])],
    [200, body({ ...pair, refresh_token: "" })], [200, body({ ...pair, access_token: "a b" })], [200, body({ ...pair, expires_in: "90" })],
    [200, body({ ...pair, expires_in: 0 })], [200, body({ ...pair, access_token: "x".repeat(16 * 1024 + 1) })],
  ] as const) assert.deepEqual(classifyTokenReply(status, text), { kind: "unrecognized" }, `${String(status)} ${text.slice(0, 40)}`)
})
