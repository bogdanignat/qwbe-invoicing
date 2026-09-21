import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import { createBrowserTransport } from "./browser-transport.ts"

void test("uses only the same-origin BFF path and carries the login token only in its request body", async () => {
  let requested: string | URL | Request = ""
  let init: RequestInit | undefined
  const transport = createBrowserTransport({
    fetch: (input, requestInit) => {
      requested = input
      init = requestInit
      return Promise.resolve(Response.json({ authenticated: true, csrfToken: "csrf" }))
    },
    onUnauthorized: () => undefined,
  })
  await transport.json("/api/session", { method: "POST", body: { token: "secret" } })
  assert.equal(requested, "/api/qwbe/session")
  assert.ok(init)
  assert.equal(init.credentials, "same-origin")
  assert.equal(new Headers(init.headers).has("authorization"), false)
  assert.equal(init.body, JSON.stringify({ token: "secret" }))
})

void test("notifies only on 401 and preserves 403", async () => {
  let unauthorized = 0
  const statuses = [403, 401]
  const transport = createBrowserTransport({
    fetch: () => Promise.resolve(Response.json({ error: "origin_not_allowed" }, { status: statuses.shift() ?? 500 })),
    onUnauthorized: () => { unauthorized += 1 },
  })
  await assert.rejects(transport.json("/api/session"), (error: unknown) => error instanceof ApiFailure && error.status === 403)
  assert.equal(unauthorized, 0)
  await assert.rejects(transport.json("/api/session"), (error: unknown) => error instanceof ApiFailure && error.status === 401)
  assert.equal(unauthorized, 1)
})

void test("can reserve an expected 401 for the owning auth operation", async () => {
  let unauthorized = 0
  const transport = createBrowserTransport({
    fetch: () => Promise.resolve(Response.json({ error: "invalid_credentials" }, { status: 401 })),
    onUnauthorized: () => { unauthorized += 1 },
  })
  await assert.rejects(transport.json("/api/session", { unauthorized: "ignore" }),
    (error: unknown) => error instanceof ApiFailure && error.status === 401)
  assert.equal(unauthorized, 0)
})

void test("preserves aborts and distinguishes network and invalid JSON failures", async () => {
  const aborted = new Error("aborted")
  aborted.name = "AbortError"
  const aborting = createBrowserTransport({
    fetch: () => Promise.reject(aborted), onUnauthorized: () => undefined,
  })
  await assert.rejects(aborting.json("/api/session"), (error: unknown) => error === aborted)

  const offline = createBrowserTransport({
    fetch: () => Promise.reject(new Error("offline")), onUnauthorized: () => undefined,
  })
  await assert.rejects(offline.json("/api/session"),
    (error: unknown) => error instanceof ApiFailure && error.message === "offline")

  const invalidJson = createBrowserTransport({
    fetch: () => Promise.resolve(new Response("not-json", { status: 200 })), onUnauthorized: () => undefined,
  })
  await assert.rejects(invalidJson.json("/api/session"),
    (error: unknown) => error instanceof ApiFailure && error.message === "API-ul a returnat un răspuns JSON invalid.")
})

void test("binary requests use a byte-oriented accept header and preserve bytes", async () => {
  let accept: string | null = null
  const bytes = new Uint8Array([0, 255, 10, 13])
  const transport = createBrowserTransport({
    fetch: (_input, init) => {
      accept = new Headers(init?.headers).get("accept")
      return Promise.resolve(new Response(bytes))
    },
    onUnauthorized: () => undefined,
  })
  const blob = await transport.binary("/api/documents/example/pdf")
  assert.equal(accept, "application/octet-stream")
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes)
})
