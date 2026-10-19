import assert from "node:assert/strict"
import test from "node:test"

import { Effect, Redacted } from "effect"

import { ProviderFailure } from "../../cubes/invoicing/company-lookup/index.ts"
import { OPENAPI_COMPANY_URL, OPENAPI_SEARCH_URL, createOpenapiClient } from "./openapi-client.ts"
import { failureOf, fakeTransport, json, stalledBody } from "./transport.test-support.ts"

const secret = "sk_live_DO_NOT_LEAK_0123456789"
const keyed = { organizationId: "org-1", settingsVersion: "v1", apiKey: Redacted.make(secret) }
const company = { cif: "13548146", denumire: "EXEMPLU TEST SRL", numar_reg_com: "J32/1/2000", adresa: "Sibiu, Str. Mare 1",
  judet: "Sibiu", cod_postal: "550001", tva: "2001-01-01", radiata: false, stare: "activă", meta: { ignored: true } }
const client = (reply: Parameters<typeof fakeTransport>[0], timeoutMs?: number) => {
  const fake = fakeTransport(reply)
  return { ...fake, openapi: createOpenapiClient({ transport: fake.transport, ...(timeoutMs === undefined ? {} : { timeoutMs }) }) }
}

void test("a lookup GETs the company with the key in x-api-key and keeps only the mapped fields", async () => {
  const { openapi, sent } = client(() => json(company))
  const found = await Effect.runPromise(openapi.lookup({ ...keyed, cui: "13548146" }))
  assert.deepEqual(found, { cif: "13548146", denumire: "EXEMPLU TEST SRL", numar_reg_com: "J32/1/2000", adresa: "Sibiu, Str. Mare 1",
    judet: "Sibiu", cod_postal: "550001", tva: "2001-01-01", radiata: false })
  assert.deepEqual(sent.map(({ url, method, headers, redirect }) => [url, method, headers["x-api-key"], redirect]),
    [[`${OPENAPI_COMPANY_URL}13548146`, "GET", secret, "manual"]])
  const numeric = await Effect.runPromise(client(() => json({ ...company, cif: 13548146, tva: null, radiata: null })).openapi.lookup({ ...keyed, cui: "13548146" }))
  assert.deepEqual([numeric?.cif, numeric?.tva, numeric?.radiata], ["13548146", null, false])
})

void test("a search POSTs {q} as JSON and answers data[]", async () => {
  const { openapi, sent } = client(() => json({ data: [{ cif: "13548146", denumire: "EXEMPLU TEST SRL", judet: "Sibiu", extra: 1 }] }))
  assert.deepEqual(await Effect.runPromise(openapi.search({ ...keyed, query: "Exemplu test" })),
    [{ cif: "13548146", denumire: "EXEMPLU TEST SRL", judet: "Sibiu" }])
  assert.deepEqual(sent.map(({ url, method, body, headers }) => [url, method, body, headers["content-type"], headers["x-api-key"]]),
    [[OPENAPI_SEARCH_URL, "POST", JSON.stringify({ q: "Exemplu test" }), "application/json", secret]])
})

void test("404 is no company (and no suggestions); the other codes are mapped, never retransmitted", async () => {
  assert.equal(await Effect.runPromise(client(() => json({ error: { code: 40402 } }, 404)).openapi.lookup({ ...keyed, cui: "12345674" })), undefined)
  assert.deepEqual(await Effect.runPromise(client(() => json({}, 404)).openapi.search({ ...keyed, query: "Exemplu" })), [])
  const cases: ReadonlyArray<readonly [string, () => Response, string, number | undefined]> = [
    ["429", () => json({ error: { code: 42901, message: `quota for ${secret}` } }, 429), "quota_exceeded", undefined],
    ["429 with Retry-After", () => json({}, 429, { "retry-after": "3600" }), "quota_exceeded", 30],
    ["403", () => json({ error: { message: `key ${secret} is not confirmed` } }, 403), "auth_failed", undefined],
    ["401", () => json({}, 401), "auth_failed", undefined],
    ["202 with retry_after", () => json({ retry_after: 2.2 }, 202), "pending", 3],
    ["202 bounded", () => json({ retry_after: 900 }, 202), "pending", 30],
    ["202 without a hint", () => new Response("", { status: 202 }), "pending", 5],
    ["500", () => json({ error: `boom ${secret}` }, 500), "unavailable", undefined],
    ["301", () => new Response(null, { status: 301, headers: { location: `https://evil.example/?k=${secret}` } }), "unavailable", undefined],
    ["invalid JSON", () => new Response(`not json ${secret}`, { status: 200 }), "unavailable", undefined],
    ["wrong shape", () => json({ cif: "1", denumire: 7 }), "unavailable", undefined],
  ]
  for (const [label, reply, reason, retryAfterSeconds] of cases) {
    const calls: ReadonlyArray<(c: ReturnType<typeof client>) => Effect.Effect<unknown, ProviderFailure>> = [
      (c) => c.openapi.lookup({ ...keyed, cui: "12345674" }), (c) => c.openapi.search({ ...keyed, query: "Exemplu" })]
    for (const call of calls) {
      const { failure, printed } = await failureOf(call(client(reply)))
      assert.ok(failure instanceof ProviderFailure, label)
      assert.deepEqual([failure.reason, failure.retryAfterSeconds], [reason, retryAfterSeconds], label)
      assert.equal(printed.includes(secret), false, `${label}: the key is not in the failure`)
    }
  }
})

void test("a transport error that quotes the request, or a stall, fails without the key", async () => {
  const quoting = client((sent) => { throw new TypeError(`invalid header value ${sent.headers["x-api-key"] ?? ""}`) })
  const thrown = await failureOf(quoting.openapi.lookup({ ...keyed, cui: "12345674" }))
  assert.equal(thrown.printed.includes(secret), false)
  const stalled = await failureOf(client(stalledBody, 50).openapi.lookup({ ...keyed, cui: "12345674" }))
  assert.ok(stalled.failure instanceof ProviderFailure && stalled.failure.reason === "unavailable")
  const hanging = await failureOf(client(() => new Promise<Response>(() => {}), 50).openapi.search({ ...keyed, query: "Exemplu" }))
  assert.ok(hanging.failure instanceof ProviderFailure && hanging.failure.reason === "unavailable")
})
