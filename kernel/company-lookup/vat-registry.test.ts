import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { VatRegistryUnavailable } from "../../cubes/invoicing/issuer/index.ts"
import { ANAF_URL, createAnafClient } from "./anaf-client.ts"
import { failureOf, fakeTransport, json, stalledBody } from "./transport.test-support.ts"
import { anafVatRegistry } from "./vat-registry.ts"

const company = (cui: number, scpTVA: boolean) => ({
  date_generale: { cui, denumire: "EXEMPLU TEST SRL" },
  // Periods are never read: only `scpTVA` on the day asked decides.
  inregistrare_scop_Tva: { scpTVA, perioade_TVA: [{ data_inceput_ScpTVA: "1993-07-01", data_sfarsit_ScpTVA: "" }] },
})
const registry = (reply: Parameters<typeof fakeTransport>[0], timeoutMs?: number) => {
  const fake = fakeTransport(reply)
  const anaf = createAnafClient({ transport: fake.transport, intervalMs: 0, ...(timeoutMs === undefined ? {} : { timeoutMs }) })
  return { ...fake, registry: anafVatRegistry(anaf) }
}

void test("scpTVA on the day asked is the status; a CUI ANAF does not know is unknown_cif", async () => {
  const yes = registry(() => json({ found: [company(2816464, true)], notFound: [] }))
  assert.equal(await Effect.runPromise(yes.registry.statusOn("2816464", "2025-08-01")), "registered")
  assert.deepEqual(yes.sent.map(({ url, body }) => [url, body]), [[ANAF_URL, JSON.stringify([{ cui: 2816464, data: "2025-08-01" }])]])
  const no = registry(() => json({ found: [company(45561046, false)], notFound: [] }))
  assert.equal(await Effect.runPromise(no.registry.statusOn("45561046", "2026-09-01")), "not_registered")
  const unknown = registry(() => json({ found: [], notFound: [12345674] }, 404))
  assert.equal(await Effect.runPromise(unknown.registry.statusOn("12345674", "2026-09-01")), "unknown_cif")
})

void test("every unusable answer is VatRegistryUnavailable, never a status", async () => {
  for (const reply of [() => json({}, 500), () => json({ found: [company(1, true)], notFound: [] }),
    () => new Response("<html></html>", { status: 200 }), stalledBody]) {
    const { failure } = await failureOf(registry(reply, 50).registry.statusOn("12345674", "2026-09-01"))
    assert.ok(failure instanceof VatRegistryUnavailable)
  }
})

void test("the registry is asked every time: no cache answers for another day or from an earlier save", async () => {
  let scpTVA = true
  const { registry: asked, sent } = registry(() => json({ found: [company(2816464, scpTVA)], notFound: [] }))
  assert.equal(await Effect.runPromise(asked.statusOn("2816464", "2025-08-01")), "registered")
  scpTVA = false
  assert.equal(await Effect.runPromise(asked.statusOn("2816464", "2025-08-01")), "not_registered")
  assert.equal(await Effect.runPromise(asked.statusOn("2816464", "2026-09-01")), "not_registered")
  assert.equal(sent.length, 3)
})
