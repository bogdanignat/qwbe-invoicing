import assert from "node:assert/strict"
import test from "node:test"
import { Effect } from "effect"

import { ApiFailure, apiRequest, clearApiToken, onUnauthorized, runUiEffect, setApiToken } from "./api.ts"
import { invoicingClient } from "./invoicing-client.ts"

void test("keeps the bearer token in Effect memory and clears it after 401", async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<RequestInit> = []
  let unauthorized = 0
  const unsubscribe = onUnauthorized(() => { unauthorized += 1 })
  try {
    globalThis.fetch = (_input, init) => {
      calls.push(init ?? {})
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }))
    }
    await runUiEffect(Effect.zipRight(setApiToken(" secret-token "), apiRequest("/api/test", (input) => input)))
    assert.equal(new Headers(calls[0]?.headers).get("authorization"), "Bearer secret-token")

    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ error: "AuthenticationRequired" }), { status: 401, headers: { "content-type": "application/json" } }))
    await assert.rejects(runUiEffect(apiRequest("/api/test", (input) => input)))
    assert.equal(unauthorized, 1)
    await assert.rejects(runUiEffect(apiRequest("/api/test", (input) => input)))
    assert.equal(unauthorized, 1)
  } finally {
    unsubscribe()
    await Effect.runPromise(clearApiToken)
    globalThis.fetch = originalFetch
  }
})

void test("interrupts the Effect fetch when React Query aborts", async () => {
  const originalFetch = globalThis.fetch
  let fetchAborted = false
  try {
    await Effect.runPromise(setApiToken("secret-token"))
    globalThis.fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { fetchAborted = true; reject(new DOMException("Aborted", "AbortError")) }, { once: true })
    })
    const controller = new AbortController()
    const result = runUiEffect(apiRequest("/api/test", (input) => input), controller.signal)
    controller.abort()
    await assert.rejects(result)
    assert.equal(fetchAborted, true)
  } finally {
    await Effect.runPromise(clearApiToken)
    globalThis.fetch = originalFetch
  }
})

void test("maps a missing issuer to null for TanStack Query first-run state", async () => {
  const originalFetch = globalThis.fetch
  try {
    await Effect.runPromise(setApiToken("secret-token"))
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ error: "ResourceNotFound" }), { status: 404, headers: { "content-type": "application/json" } }))
    assert.equal(await runUiEffect(invoicingClient.getIssuer()), null)
  } finally {
    await Effect.runPromise(clearApiToken)
    globalThis.fetch = originalFetch
  }
})

void test("surfaces the first typed validation issue instead of the backend tag", async () => {
  const originalFetch = globalThis.fetch
  try {
    await Effect.runPromise(setApiToken("secret-token"))
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ error: "ValidationFailure", issues: ["taxCode is required"] }), { status: 400, headers: { "content-type": "application/json" } }))
    await assert.rejects(runUiEffect(apiRequest("/api/test", (input) => input)), (error) => error instanceof ApiFailure && error.message === "taxCode is required" && error.issues.length === 1)
  } finally {
    await Effect.runPromise(clearApiToken)
    globalThis.fetch = originalFetch
  }
})
