import assert from "node:assert/strict"
import test from "node:test"

import { ApiError, createApiClient } from "./api-client.js"

void test("keeps the bearer token in memory and attaches it to API requests", async () => {
  const calls = []
  const client = createApiClient({
    fetchImplementation: (path, options) => {
      calls.push({ path, options })
      return Promise.resolve(new globalThis.Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
    },
  })
  client.setToken(" secret-token ")
  assert.deepEqual(await client.request("/api/customers", { method: "POST", body: { name: "Test" } }), { ok: true })
  assert.equal(calls[0].path, "/api/customers")
  assert.equal(calls[0].options.headers.authorization, "Bearer secret-token")
  assert.equal(calls[0].options.body, JSON.stringify({ name: "Test" }))
})

void test("clears authorization after a 401 response", async () => {
  let unauthorized = 0
  const client = createApiClient({
    fetchImplementation: () => Promise.resolve(new globalThis.Response(JSON.stringify({ error: "AuthenticationRequired" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })),
    onUnauthorized: () => { unauthorized += 1 },
  })
  client.setToken("secret-token")
  await assert.rejects(client.request("/api/customers"), (error) => error instanceof ApiError && error.status === 401)
  await assert.rejects(client.request("/api/customers"), (error) => error instanceof ApiError && error.status === 401)
  assert.equal(unauthorized, 1)
})
