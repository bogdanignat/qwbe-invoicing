import assert from "node:assert/strict"
import test from "node:test"

import { Deferred, Effect, Redacted } from "effect"

import { ProviderFailure } from "../../cubes/invoicing/company-lookup/index.ts"
import { CAPACITY, TTL_MS, createLookupCache } from "./lookup-cache.ts"
import { createCompanyLookupProviders } from "./providers.ts"
import { fakeTransport, json } from "./transport.test-support.ts"

const counted = <A>(value: A) => {
  let calls = 0
  return { load: Effect.sync(() => { calls += 1; return value }), calls: () => calls }
}

void test("an answer is served from memory until its 24 hours are up", async () => {
  let clock = 0
  const cache = createLookupCache({ now: () => clock })
  const { load, calls } = counted("answer")
  assert.equal(await Effect.runPromise(cache.get("k", load)), "answer")
  clock = TTL_MS - 1
  assert.equal(await Effect.runPromise(cache.get("k", load)), "answer")
  assert.equal(calls(), 1)
  clock = TTL_MS + 1
  await Effect.runPromise(cache.get("k", load))
  assert.equal(calls(), 2, "expired, asked again")
})

void test("'not found' is remembered, a failure is not", async () => {
  const cache = createLookupCache()
  const missing = counted(undefined)
  await Effect.runPromise(cache.get("missing", missing.load))
  await Effect.runPromise(cache.get("missing", missing.load))
  assert.equal(missing.calls(), 1)
  let failures = 0
  const failing = Effect.suspend(() => { failures += 1; return Effect.fail(new ProviderFailure({ reason: "unavailable" })) })
  for (let attempt = 0; attempt < 2; attempt += 1) await Effect.runPromise(Effect.either(cache.get("failing", failing)))
  assert.equal(failures, 2)
})

void test("identical questions in flight share one load, and so does its failure", async () => {
  const cache = createLookupCache()
  const gate = await Effect.runPromise(Deferred.make<string, ProviderFailure>())
  let loads = 0
  const load = Effect.suspend(() => { loads += 1; return Deferred.await(gate) })
  const waiting = Effect.runPromise(Effect.all([cache.get("k", load), cache.get("k", load), cache.get("k", load)], { concurrency: "unbounded" }))
  await new Promise((resolve) => setTimeout(resolve, 10))
  await Effect.runPromise(Deferred.succeed(gate, "shared"))
  assert.deepEqual(await waiting, ["shared", "shared", "shared"])
  assert.equal(loads, 1)

  const refused = await Effect.runPromise(Deferred.make<string, ProviderFailure>())
  const failing = Effect.suspend(() => { loads += 1; return Deferred.await(refused) })
  const both = Effect.runPromise(Effect.all([cache.get("f", failing), cache.get("f", failing)].map(Effect.either), { concurrency: "unbounded" }))
  await new Promise((resolve) => setTimeout(resolve, 10))
  await Effect.runPromise(Deferred.fail(refused, new ProviderFailure({ reason: "quota_exceeded" })))
  assert.deepEqual((await both).map((result) => result._tag), ["Left", "Left"])
  assert.equal(loads, 2)
})

void test("past 500 answers the least recently used one goes first", async () => {
  const cache = createLookupCache()
  for (let index = 0; index < CAPACITY; index += 1) await Effect.runPromise(cache.get(`k${String(index)}`, Effect.succeed(index)))
  await Effect.runPromise(cache.get("k0", Effect.succeed(-1)))
  await Effect.runPromise(cache.get("new", Effect.succeed(0)))
  assert.equal(await Effect.runPromise(cache.get("k0", Effect.succeed(-1))), 0, "used recently, kept")
  assert.equal(await Effect.runPromise(cache.get("k1", Effect.succeed(-1))), -1, "least recently used, evicted")
})

void test("the providers' cache is keyed by organization and settings version, never by the key", async () => {
  const { transport, sent } = fakeTransport((request) => request.url.includes("anaf")
    ? json({ found: [], notFound: [12345674] }) : json({ data: [] }))
  const providers = createCompanyLookupProviders({ transport, intervalMs: 0 })
  const ask = (organizationId: string, settingsVersion: string) =>
    Effect.runPromise(providers.anaf.lookup({ organizationId, settingsVersion, cui: "12345674" }))
  await ask("org-1", "v1")
  await ask("org-1", "v1")
  assert.equal(sent.length, 1)
  await ask("org-1", "v2")
  await ask("org-2", "v1")
  assert.equal(sent.length, 3, "new settings or another organization ask again")
  const search = (query: string, key: string) => Effect.runPromise(providers.openapi.search({
    organizationId: "org-1", settingsVersion: "v3", apiKey: Redacted.make(key), query }))
  await search("Exemplu  Test", "key-one-0123")
  await search("exemplu test", "key-two-0123")
  assert.equal(sent.length, 4, "the normalized query is the key; the API key is not part of it")
})
