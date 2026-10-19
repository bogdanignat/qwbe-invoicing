import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { ProviderFailure } from "../../cubes/invoicing/company-lookup/index.ts"
import { ANAF_URL, createAnafClient } from "./anaf-client.ts"
import { MAX_BODY_BYTES } from "./provider-http.ts"
import { failureOf, fakeTransport, json, oversizedBody, stalledBody } from "./transport.test-support.ts"

const request = { organizationId: "org-1", settingsVersion: "v1" }
const company = (cui: number) => ({
  date_generale: { cui, denumire: "EXEMPLU TEST SRL", nrRegCom: "J22/1/2020", stare_inregistrare: "INREGISTRAT", extra: "ignored" },
  inregistrare_scop_Tva: { scpTVA: true, perioade_TVA: [] },
  stare_inactiv: { statusInactivi: false, dataRadiere: "" },
  adresa_sediu_social: { sdenumire_Strada: "Str. Mare", snumar_Strada: "1", sdenumire_Localitate: "Mun. Iași", scod_JudetAuto: "IS", scod_Postal: "700001" },
  date_generale_extra: { anything: 1 },
})
// 21:30 UTC on 18 October is already 19 October in Bucharest.
const now = () => new Date("2026-10-18T21:30:00.000Z")
const client = (reply: Parameters<typeof fakeTransport>[0], extra: { readonly timeoutMs?: number; readonly intervalMs?: number } = {}) => {
  const fake = fakeTransport(reply)
  return { ...fake, anaf: createAnafClient({ transport: fake.transport, now, intervalMs: 0, ...extra }) }
}
const reason = async (effect: Effect.Effect<unknown, ProviderFailure>) => {
  const { failure } = await failureOf(effect)
  assert.ok(failure instanceof ProviderFailure)
  return failure.reason
}

void test("ANAF is asked by POST with the CUI as a number and today's date in Bucharest", async () => {
  const { anaf, sent } = client(() => json({ cod: 200, message: "SUCCESS", found: [company(13548146)], notFound: [] }))
  const found = await Effect.runPromise(anaf.lookup({ ...request, cui: "13548146" }))
  assert.ok(found !== undefined)
  assert.equal(found.date_generale.denumire, "EXEMPLU TEST SRL")
  assert.equal(found.adresa_sediu_social?.scod_JudetAuto, "IS")
  assert.equal("extra" in found.date_generale, false, "fields the mapping does not read are dropped")
  assert.deepEqual(sent.map(({ url, method, body, redirect, headers }) => [url, method, body, redirect, headers["content-type"]]),
    [[ANAF_URL, "POST", JSON.stringify([{ cui: 13548146, data: "2026-10-19" }]), "manual", "application/json"]])
})

void test("notFound is no company; an answer about another CUI or neither list is a failure", async () => {
  assert.equal(await Effect.runPromise(client(() => json({ found: [], notFound: [12345674] })).anaf.lookup({ ...request, cui: "12345674" })), undefined)
  assert.equal(await reason(client(() => json({ found: [company(1)], notFound: [] })).anaf.lookup({ ...request, cui: "12345674" })), "unavailable")
  assert.equal(await reason(client(() => json({ found: [], notFound: [] })).anaf.lookup({ ...request, cui: "12345674" })), "unavailable")
})

void test("every answer that is not usable data is unavailable, and quotes nothing of it", async () => {
  const replies: ReadonlyArray<readonly [string, () => Response]> = [
    ["500", () => json({ error: "upstream secret detail" }, 500)],
    ["404", () => json({}, 404)],
    ["429", () => json({}, 429)],
    ["redirect", () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } })],
    ["invalid JSON", () => new Response("<html>upstream secret detail</html>", { status: 200 })],
    ["wrong shape", () => json({ found: [{ date_generale: { cui: "x" } }], notFound: [] })],
    ["declared too large", () => new Response("{}", { status: 200, headers: { "content-length": String(MAX_BODY_BYTES + 1) } })],
    ["streamed too large", () => oversizedBody(MAX_BODY_BYTES + 1)],
  ]
  for (const [label, reply] of replies) {
    const { failure, printed } = await failureOf(client(reply).anaf.lookup({ ...request, cui: "12345674" }))
    assert.ok(failure instanceof ProviderFailure && failure.reason === "unavailable", label)
    assert.equal(printed.includes("upstream secret detail"), false, label)
  }
  const thrown = await failureOf(client(() => { throw new Error("connect ECONNREFUSED upstream secret detail") }).anaf.lookup({ ...request, cui: "12345674" }))
  assert.equal(thrown.printed.includes("upstream secret detail"), false)
})

void test("a reply that stalls, before or during the body, times out", async () => {
  const hanging = client(() => new Promise<Response>(() => {}), { timeoutMs: 50 })
  assert.equal(await reason(hanging.anaf.lookup({ ...request, cui: "12345674" })), "unavailable")
  const stalled = client(stalledBody, { timeoutMs: 50 })
  const started = Date.now()
  assert.equal(await reason(stalled.anaf.lookup({ ...request, cui: "12345674" })), "unavailable")
  assert.ok(Date.now() - started < 2_000)
})

void test("requests leave one at a time, spaced by the interval", async () => {
  const starts: Array<number> = []
  const { anaf } = client(() => { starts.push(Date.now()); return json({ found: [], notFound: [1] }) }, { intervalMs: 120 })
  await Effect.runPromise(Effect.all(["12345674", "13548146", "14399840"].map((cui) => anaf.lookup({ ...request, cui })), { concurrency: "unbounded" }))
  assert.equal(starts.length, 3)
  for (let index = 1; index < starts.length; index += 1) {
    assert.ok((starts[index] ?? 0) - (starts[index - 1] ?? 0) >= 110, `gap ${String(index)}: ${JSON.stringify(starts)}`)
  }
})

void test("a slow answer does not hold the queue: the next request starts after the interval, not after the answer", async () => {
  const starts: Array<number> = []
  const finishes: Array<number> = []
  const { anaf } = client(async () => {
    starts.push(Date.now())
    await new Promise((resolve) => setTimeout(resolve, 300))
    finishes.push(Date.now())
    return json({ found: [], notFound: [1] })
  }, { intervalMs: 50 })
  await Effect.runPromise(Effect.all(["12345674", "13548146", "14399840"].map((cui) => anaf.lookup({ ...request, cui })), { concurrency: "unbounded" }))
  assert.equal(starts.length, 3)
  const [first, second, third] = starts.map((start) => start - (starts[0] ?? 0))
  assert.ok(first === 0 && (second ?? 0) >= 40 && (third ?? 0) - (second ?? 0) >= 40, `spaced: ${JSON.stringify(starts)}`)
  assert.ok((starts[2] ?? 0) < (finishes[0] ?? 0), `all three in flight before the first answer: ${JSON.stringify({ starts, finishes })}`)
})

void test("past ten callers waiting, the next one is told unavailable at once", async () => {
  const { anaf, sent } = client(() => json({ found: [], notFound: [1] }), { intervalMs: 20 })
  const results = await Effect.runPromise(Effect.all(Array.from({ length: 12 }, () =>
    Effect.either(anaf.lookup({ ...request, cui: "12345674" }))), { concurrency: "unbounded" }))
  const refused = results.filter((result) => result._tag === "Left").length
  assert.ok(refused >= 1 && refused <= 2, String(refused))
  assert.equal(sent.length, 12 - refused, "a refused caller never reaches ANAF")
})
