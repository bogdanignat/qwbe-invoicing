import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure, apiRequest, clearApiSession, loginApiSession, logoutApiSession, onUnauthorized, restoreApiSession, runUiEffect } from "./api.ts"
import { invoicingClient } from "./invoicing-client.ts"

const requestPath = (input: Parameters<typeof fetch>[0]): string => {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return input.url
}

void test("exchanges the API token for a cookie session and clears memory after 401", async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ readonly input: string; readonly init: RequestInit }> = []
  let unauthorized = 0
  const unsubscribe = onUnauthorized(() => { unauthorized += 1 })
  try {
    globalThis.fetch = (input, init) => {
      const path = requestPath(input)
      calls.push({ input: path, init: init ?? {} })
      const body = path === "/api/session"
        ? { authenticated: true, csrfToken: "csrf-token" }
        : { ok: true }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }))
    }
    await runUiEffect(loginApiSession(" secret-token "))
    await runUiEffect(apiRequest("/api/test", (input) => input, { method: "POST", body: { ok: true } }))
    const loginCall = calls[0]
    const apiCall = calls[1]
    assert.ok(loginCall)
    assert.ok(apiCall)
    assert.equal(loginCall.input, "/api/session")
    assert.equal(loginCall.init.credentials, "same-origin")
    const loginBody = loginCall.init.body
    if (typeof loginBody !== "string") throw new Error("Expected the login request body to be JSON")
    assert.deepEqual(JSON.parse(loginBody), { token: "secret-token" })
    assert.equal(new Headers(apiCall.init.headers).get("authorization"), null)
    assert.equal(new Headers(apiCall.init.headers).get("x-csrf-token"), "csrf-token")

    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ error: "AuthenticationRequired" }), { status: 401, headers: { "content-type": "application/json" } }))
    await assert.rejects(runUiEffect(apiRequest("/api/test", (input) => input)))
    assert.equal(unauthorized, 1)
    await assert.rejects(runUiEffect(apiRequest("/api/test", (input) => input)))
    assert.equal(unauthorized, 1)
  } finally {
    unsubscribe()
    await runUiEffect(clearApiSession)
    globalThis.fetch = originalFetch
  }
})

void test("restores the cookie session without asking for the API token again", async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ authenticated: true, csrfToken: "restored-csrf" }), { status: 200, headers: { "content-type": "application/json" } }))
    await runUiEffect(restoreApiSession)
    globalThis.fetch = (_input, init) => {
      assert.equal(new Headers(init?.headers).get("x-csrf-token"), "restored-csrf")
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }))
    }
    await runUiEffect(apiRequest("/api/test", (input) => input, { method: "POST", body: { ok: true } }))
  } finally {
    await runUiEffect(clearApiSession)
    globalThis.fetch = originalFetch
  }
})

void test("treats an already expired server session as a successful local logout", async () => {
  const originalFetch = globalThis.fetch
  const methods: Array<string> = []
  try {
    globalThis.fetch = (_input, init) => {
      methods.push(init?.method ?? "GET")
      if (init?.method === "DELETE") {
        assert.equal(new Headers(init.headers).get("x-csrf-token"), "csrf-token")
        return Promise.resolve(new Response(JSON.stringify({ error: "AuthenticationRequired" }), { status: 401, headers: { "content-type": "application/json" } }))
      }
      return Promise.resolve(new Response(JSON.stringify({ authenticated: true, csrfToken: "csrf-token" }), { status: 200, headers: { "content-type": "application/json" } }))
    }
    await runUiEffect(loginApiSession("secret-token"))
    await runUiEffect(logoutApiSession)
    await assert.rejects(runUiEffect(apiRequest("/api/test", (input) => input)))
    assert.deepEqual(methods, ["POST", "DELETE"])
  } finally {
    await runUiEffect(clearApiSession)
    globalThis.fetch = originalFetch
  }
})

void test("localizes invalid session credentials", async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ error: "invalid_credentials" }), { status: 401, headers: { "content-type": "application/json" } }))
    await assert.rejects(runUiEffect(loginApiSession("wrong-token")), (error) =>
      error instanceof ApiFailure && error.message === "Tokenul API este incorect.")
  } finally {
    await runUiEffect(clearApiSession)
    globalThis.fetch = originalFetch
  }
})

void test("interrupts the Effect fetch when React Query aborts", async () => {
  const originalFetch = globalThis.fetch
  let fetchAborted = false
  try {
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ authenticated: true, csrfToken: "csrf-token" }), { status: 200, headers: { "content-type": "application/json" } }))
    await runUiEffect(loginApiSession("secret-token"))
    globalThis.fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { fetchAborted = true; reject(new DOMException("Aborted", "AbortError")) }, { once: true })
    })
    const controller = new AbortController()
    const result = runUiEffect(apiRequest("/api/test", (input) => input), controller.signal)
    controller.abort()
    await assert.rejects(result)
    assert.equal(fetchAborted, true)
  } finally {
    await runUiEffect(clearApiSession)
    globalThis.fetch = originalFetch
  }
})

void test("maps a missing issuer to null for TanStack Query first-run state", async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = (input) => {
      const sessionRequest = requestPath(input) === "/api/session"
      return Promise.resolve(new Response(JSON.stringify(sessionRequest ? { authenticated: true, csrfToken: "csrf-token" } : { error: "ResourceNotFound" }), { status: sessionRequest ? 200 : 404, headers: { "content-type": "application/json" } }))
    }
    await runUiEffect(loginApiSession("secret-token"))
    assert.equal(await runUiEffect(invoicingClient.getIssuer()), null)
  } finally {
    await runUiEffect(clearApiSession)
    globalThis.fetch = originalFetch
  }
})

void test("surfaces the first typed validation issue instead of the backend tag", async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = (input) => {
      const sessionRequest = requestPath(input) === "/api/session"
      return Promise.resolve(new Response(JSON.stringify(sessionRequest ? { authenticated: true, csrfToken: "csrf-token" } : { error: "ValidationFailure", issues: ["taxCode is required"] }), { status: sessionRequest ? 200 : 400, headers: { "content-type": "application/json" } }))
    }
    await runUiEffect(loginApiSession("secret-token"))
    await assert.rejects(runUiEffect(apiRequest("/api/test", (input) => input)), (error) => error instanceof ApiFailure && error.message === "taxCode is required" && error.issues.length === 1)
  } finally {
    await runUiEffect(clearApiSession)
    globalThis.fetch = originalFetch
  }
})

void test("localizes duplicate document series conflicts", async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = (input) => {
      const sessionRequest = requestPath(input) === "/api/session"
      return Promise.resolve(new Response(JSON.stringify(sessionRequest
        ? { authenticated: true, csrfToken: "csrf-token" }
        : { error: "DomainConflict", code: "document_series_exists" }), {
        status: sessionRequest ? 200 : 409,
        headers: { "content-type": "application/json" },
      }))
    }
    await runUiEffect(loginApiSession("secret-token"))
    await assert.rejects(
      runUiEffect(invoicingClient.createDocumentSeries({ documentType: "invoice", series: "QWBE" })),
      (error) => error instanceof ApiFailure && error.message === "Seria există deja pentru acest tip de document.",
    )
  } finally {
    await runUiEffect(clearApiSession)
    globalThis.fetch = originalFetch
  }
})

void test("lists and creates document series with the final API contract", async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ readonly path: string; readonly init: RequestInit }> = []
  try {
    globalThis.fetch = (input, init) => {
      const path = requestPath(input)
      calls.push({ path, init: init ?? {} })
      const body = path === "/api/session"
        ? { authenticated: true, csrfToken: "csrf-token" }
        : path === "/api/drafts"
          ? { id: "draft-1", organizationId: "org-1", customerId: "customer-1", customer: { partyType: "company", legalName: "Client", taxIdentifier: "RO1", address: { countryCode: "RO", city: "Iași", street: "Strada 1" } }, series: "QWBE", issueDate: "2026-09-01", dueDate: "2026-09-16", currency: "RON", status: "draft", lines: [], taxBreakdown: [], totalExcludingTax: "0.00", taxTotal: "0.00", totalIncludingTax: "0.00" }
        : init?.method === "POST"
          ? { organizationId: "org-1", documentType: "invoice", series: "QWBE" }
          : [{ organizationId: "org-1", documentType: "invoice", series: "QWBE" }]
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }))
    }
    await runUiEffect(loginApiSession("secret-token"))
    assert.equal((await runUiEffect(invoicingClient.listDocumentSeries()))[0]?.series, "QWBE")
    await runUiEffect(invoicingClient.createDocumentSeries({ documentType: "invoice", series: "QWBE" }))
    const listCall = calls[1]
    const createCall = calls[2]
    assert.ok(listCall)
    assert.ok(createCall)
    assert.equal(listCall.path, "/api/document-series")
    assert.equal(listCall.init.method, "GET")
    assert.equal(createCall.path, "/api/document-series")
    assert.equal(createCall.init.method, "POST")
    const requestBody = createCall.init.body
    if (typeof requestBody !== "string") throw new Error("Expected document series request body to be JSON")
    assert.deepEqual(JSON.parse(requestBody), { documentType: "invoice", series: "QWBE" })
    await runUiEffect(invoicingClient.createDraft({ customerId: "customer-1", series: "QWBE", issueDate: "2026-09-01" }))
    const draftCall = calls[3]
    assert.ok(draftCall)
    assert.equal(draftCall.path, "/api/drafts")
    const draftRequestBody = draftCall.init.body
    if (typeof draftRequestBody !== "string") throw new Error("Expected draft request body to be JSON")
    assert.deepEqual(JSON.parse(draftRequestBody), { customerId: "customer-1", series: "QWBE", issueDate: "2026-09-01" })
  } finally {
    await runUiEffect(clearApiSession)
    globalThis.fetch = originalFetch
  }
})
