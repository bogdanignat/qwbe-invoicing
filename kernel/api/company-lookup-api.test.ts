import assert from "node:assert/strict"
import test from "node:test"

import { json } from "../company-lookup/transport.test-support.ts"
import { withMigrated } from "../storage/postgres-rig.test-support.ts"
import { companyLookupRig, secret } from "./company-lookup-api.test-support.ts"

const anafCompany = { found: [{ date_generale: { cui: 13548146, denumire: "EXEMPLU TEST SRL", nrRegCom: "J32/1/2000" },
  inregistrare_scop_Tva: { scpTVA: true }, adresa_sediu_social: { sdenumire_Localitate: "Sibiu", scod_JudetAuto: "SB" } }], notFound: [] }
const routes: ReadonlyArray<readonly [string, string, unknown, "lookup" | "settings"]> = [
  ["GET", "/settings/company-lookup", undefined, "settings"],
  ["PUT", "/settings/company-lookup", { provider: "anaf" }, "settings"],
  ["GET", "/company-lookup/availability", undefined, "lookup"],
  ["POST", "/company-lookup/lookup", { cui: "13548146" }, "lookup"],
  ["POST", "/company-lookup/search", { q: "Exemplu" }, "lookup"],
]

void test("company lookup: each route takes its own permission, and an off plugin has no route at all", async () => {
  await withMigrated("lookup_acl", async (fixture) => {
    const rig = companyLookupRig(fixture.pool, fixture.dataDirectory)
    try {
      for (const [method, path, body, needs] of routes) {
        for (const token of ["none", needs === "lookup" ? "settings" : "lookup"]) {
          const reply = await rig.call(method, path, body, token)
          assert.deepEqual([reply.status, reply.body], [403, { error: "PermissionDenied" }], `${method} ${path} as ${token}`)
        }
        assert.equal((await rig.call(method, path, body, "nobody")).status, 401, `${method} ${path} unauthenticated`)
      }
      assert.equal(rig.sent.length, 0)
    } finally { await rig.dispose() }
    const off = companyLookupRig(fixture.pool, fixture.dataDirectory, { plugins: { payments: true, efactura: true, "company-lookup": false } })
    try {
      for (const [method, path, body] of routes) {
        const reply = await off.call(method, path, body)
        assert.deepEqual([reply.status, reply.body], [404, { error: "not_found" }], `${method} ${path}`)
      }
    } finally { await off.dispose() }
  })
})

void test("company lookup settings: write-only key, encrypted at rest, refused without a master key", async () => {
  await withMigrated("lookup_settings", async (fixture) => {
    const rig = companyLookupRig(fixture.pool, fixture.dataDirectory)
    const { call } = rig
    try {
      assert.deepEqual((await call("GET", "/settings/company-lookup")).body, { provider: "none", openapiKeyConfigured: false, openapiKeyLast4: null })
      assert.equal((await call("PUT", "/settings/company-lookup", { provider: "openapi" })).status, 400)
      for (const bad of [`${secret} `, 12345678901, [secret], { value: secret }]) {
        const refused = await call("PUT", "/settings/company-lookup", { provider: "openapi", openapiKey: bad })
        assert.equal(refused.status, 400, refused.text)
        assert.equal(refused.text.includes(secret), false, refused.text)
      }
      const saved = await call("PUT", "/settings/company-lookup", { provider: "openapi", openapiKey: secret })
      assert.deepEqual([saved.status, saved.body], [200, { provider: "openapi", openapiKeyConfigured: true, openapiKeyLast4: "wxyz" }])
      const { rows } = await fixture.pool.query<{ openapi_key_ciphertext: string }>("SELECT openapi_key_ciphertext FROM company_lookup_settings")
      assert.equal(rows.length, 1)
      assert.equal(String(rows[0]?.openapi_key_ciphertext).includes(secret), false)
      assert.deepEqual((await call("GET", "/settings/company-lookup")).body, saved.body)
      assert.deepEqual((await call("PUT", "/settings/company-lookup", { provider: "anaf" })).body,
        { provider: "anaf", openapiKeyConfigured: true, openapiKeyLast4: "wxyz" }, "kept without being read")
      assert.deepEqual((await call("PUT", "/settings/company-lookup", { provider: "anaf", clearOpenapiKey: true })).body,
        { provider: "anaf", openapiKeyConfigured: false, openapiKeyLast4: null })
    } finally { await rig.dispose() }
    const withoutMaster = companyLookupRig(fixture.pool, fixture.dataDirectory, { master: false })
    try {
      const refused = await withoutMaster.call("PUT", "/settings/company-lookup", { provider: "openapi", openapiKey: secret })
      assert.deepEqual([refused.status, refused.body], [409, { error: "DomainConflict", code: "company_lookup_key_storage_unavailable" }])
      assert.equal((await withoutMaster.call("PUT", "/settings/company-lookup", { provider: "anaf" })).status, 200, "ANAF needs no key")
    } finally { await withoutMaster.dispose() }
    for (const text of [...rig.logs, ...withoutMaster.logs]) assert.equal(text.includes(secret), false, text)
  })
})

void test("company lookup: thresholds and settings are checked before any request, answers are cached per settings", async () => {
  await withMigrated("lookup_anaf", async (fixture) => {
    const rig = companyLookupRig(fixture.pool, fixture.dataDirectory)
    const { call, sent } = rig
    try {
      const notConfigured = await call("POST", "/company-lookup/lookup", { cui: "13548146" })
      assert.deepEqual([notConfigured.status, notConfigured.body], [409, { error: "DomainConflict", code: "company_lookup_not_configured" }])
      await call("PUT", "/settings/company-lookup", { provider: "anaf" })
      assert.deepEqual((await call("GET", "/company-lookup/availability", undefined, "lookup")).body,
        { provider: "anaf", nameSearch: false, minCuiDigits: 4, minNameLetters: 6 })
      for (const cui of ["123", "13548147", "RO12A"]) assert.equal((await call("POST", "/company-lookup/lookup", { cui })).status, 400, cui)
      assert.equal((await call("POST", "/company-lookup/search", { q: "Ex 12" })).status, 400)
      assert.equal(sent.length, 0, "nothing below the thresholds or unconfigured leaves the application")

      rig.reply(() => json(anafCompany))
      const found = await call("POST", "/company-lookup/lookup", { cui: "RO13548146" }, "lookup")
      assert.equal(found.status, 200, found.text)
      assert.deepEqual([found.body.name, found.body.cui, (found.body.address as Record<string, unknown>).county], ["EXEMPLU TEST SRL", "13548146", "RO-SB"])
      assert.equal((await call("POST", "/company-lookup/lookup", { cui: "13548146" })).status, 200)
      assert.equal(sent.length, 1, "the second lookup is answered from the cache")
      const noSearch = await call("POST", "/company-lookup/search", { q: "Exemplu" })
      assert.deepEqual(noSearch.body, { error: "DomainConflict", code: "company_search_unavailable" })

      await call("PUT", "/settings/company-lookup", { provider: "none" })
      assert.equal((await call("POST", "/company-lookup/lookup", { cui: "13548146" })).status, 409, "switched off: no answer, not even a cached one")
      rig.reply(() => json({ found: [], notFound: [12345674] }))
      await call("PUT", "/settings/company-lookup", { provider: "anaf" })
      const missing = await call("POST", "/company-lookup/lookup", { cui: "12345674" })
      assert.deepEqual([missing.status, missing.body], [404, { error: "ResourceNotFound" }])
      assert.equal(sent.length, 2)
    } finally { await rig.dispose() }
  })
})

void test("company lookup: openapi.ro failures are mapped, never 401, and the key is in no answer or log", async () => {
  await withMigrated("lookup_openapi", async (fixture) => {
    const rig = companyLookupRig(fixture.pool, fixture.dataDirectory)
    const { call, sent } = rig
    try {
      await call("PUT", "/settings/company-lookup", { provider: "openapi", openapiKey: secret })
      const cases: ReadonlyArray<readonly [() => Response, number, string, number | undefined]> = [
        [() => json({ error: { code: 42901, message: `quota ${secret}` } }, 429), 429, "quota_exceeded", undefined],
        [() => json({ error: `invalid key ${secret}` }, 403), 502, "auth_failed", undefined],
        [() => json({}, 401), 502, "auth_failed", undefined],
        [() => json({ retry_after: 4 }, 202), 503, "pending", 4],
        [() => json({ error: `boom ${secret}` }, 500), 502, "unavailable", undefined],
      ]
      for (const [reply, status, reason, retryAfterSeconds] of cases) {
        rig.reply(reply)
        for (const [path, body] of [["/company-lookup/lookup", { cui: "13548146" }], ["/company-lookup/search", { q: "Exemplu test" }]] as const) {
          const answer = await call("POST", path, body)
          assert.equal(answer.status, status, `${reason} ${path}`)
          assert.deepEqual([answer.body.error, answer.body.reason, answer.body.retryAfterSeconds], ["ProviderFailure", reason, retryAfterSeconds])
          assert.equal(typeof answer.body.message, "string")
          assert.equal(answer.text.includes(secret), false)
        }
      }
      assert.equal(sent.length, cases.length * 2, "a failure is never cached")
      assert.ok(sent.every((request) => request.headers["x-api-key"] === secret))

      rig.reply(() => json({ cif: "13548146", denumire: "EXEMPLU TEST SRL", judet: "Sibiu", adresa: "Sibiu, Str. Mare 1", radiata: false }))
      assert.equal((await call("POST", "/company-lookup/lookup", { cui: "13548146" })).status, 200)
      assert.equal((await call("POST", "/company-lookup/lookup", { cui: "13548146" })).status, 200)
      const replaced = `${secret}-replaced`
      await call("PUT", "/settings/company-lookup", { provider: "openapi", openapiKey: replaced })
      assert.equal((await call("POST", "/company-lookup/lookup", { cui: "13548146" })).status, 200)
      assert.deepEqual(sent.slice(cases.length * 2).map((request) => request.headers["x-api-key"]), [secret, replaced],
        "cached once, asked again with the new key")
      for (const text of rig.logs) assert.equal(text.includes(secret), false, text)
    } finally { await rig.dispose() }
  })
})

void test("company lookup: a rotated master key reads as off, says so once, and a new key repairs it", async () => {
  await withMigrated("lookup_rotated", async (fixture) => {
    const before = companyLookupRig(fixture.pool, fixture.dataDirectory)
    try {
      assert.equal((await before.call("PUT", "/settings/company-lookup", { provider: "openapi", openapiKey: secret })).status, 200)
    } finally { await before.dispose() }
    // Every rig draws its own master key: this one cannot open what the first one sealed.
    const rotated = companyLookupRig(fixture.pool, fixture.dataDirectory)
    const { call, sent, logs } = rotated
    try {
      const off = { provider: "none", openapiKeyConfigured: false, openapiKeyLast4: null }
      assert.deepEqual((await call("GET", "/settings/company-lookup")).body, off)
      assert.deepEqual((await call("GET", "/settings/company-lookup")).body, off)
      assert.equal((await call("GET", "/company-lookup/availability")).body.provider, "none")
      const refused = await call("POST", "/company-lookup/lookup", { cui: "13548146" })
      assert.deepEqual([refused.status, refused.body], [409, { error: "DomainConflict", code: "company_lookup_not_configured" }])
      assert.equal(sent.length, 0)
      const unreadable = logs.filter((line) => line.includes("does not open"))
      assert.equal(unreadable.length, 1, JSON.stringify(logs))
      assert.equal(logs.some((line) => line.includes(secret)), false)

      const repaired = await call("PUT", "/settings/company-lookup", { provider: "openapi", openapiKey: secret })
      assert.deepEqual([repaired.status, repaired.body], [200, { provider: "openapi", openapiKeyConfigured: true, openapiKeyLast4: "wxyz" }])
      rotated.reply(() => json({ cif: "13548146", denumire: "EXEMPLU TEST SRL", judet: "Sibiu", radiata: false }))
      assert.equal((await call("POST", "/company-lookup/lookup", { cui: "13548146" })).status, 200)
      assert.deepEqual(sent.map((request) => request.headers["x-api-key"]), [secret])
      assert.equal(logs.filter((line) => line.includes("does not open")).length, 1, "nothing more to report once repaired")
    } finally { await rotated.dispose() }
  })
})
