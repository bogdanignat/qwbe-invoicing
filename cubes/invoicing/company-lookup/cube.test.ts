import assert from "node:assert/strict"
import test from "node:test"

import { Effect, Redacted } from "effect"

import { DomainConflict, PermissionDenied, ResourceNotFound, ValidationFailure, cube as invoicing, invoicingPermissions } from "../index.ts"
import {
  ProviderFailure, companyLookupMigrations, companyLookupPermission, createCompanyLookupService, cube,
  type CompanyLookupProviders, type SettingsWrite, type StoredSettings,
} from "./index.ts"

const lookupPermission = companyLookupPermission("company-lookup")
const settingsPermission = invoicingPermissions("invoicing").manageSettings
const key = Redacted.make("sk_test_0123456789wxyz")

const rig = (permissions: ReadonlyArray<string>, initial?: StoredSettings) => {
  let row = initial
  const writes: Array<SettingsWrite> = []
  const calls: Array<string> = []
  const providers: CompanyLookupProviders = {
    anaf: { lookup: ({ cui }) => Effect.sync(() => { calls.push(`anaf:${cui}`) }).pipe(Effect.as(cui === "1235" ? undefined : {
      date_generale: { cui: Number(cui), denumire: "EXEMPLU TEST SRL" }, inregistrare_scop_Tva: { scpTVA: true },
    })) },
    openapi: {
      lookup: ({ cui, apiKey }) => Effect.sync(() => { calls.push(`openapi:${cui}:${Redacted.value(apiKey)}`) })
        .pipe(Effect.as({ cif: cui, denumire: "EXEMPLU TEST SRL", radiata: false })),
      search: ({ query }) => Effect.sync(() => { calls.push(`search:${query}`) })
        .pipe(Effect.as([{ cif: "12345674", denumire: "EXEMPLU TEST SRL" }])),
    },
  }
  const service = createCompanyLookupService({
    context: { current: Effect.succeed({ identity: { id: "user-1", username: "owner", roles: ["admin"], permissions }, organization: { id: "org-1" } }) },
    clock: { now: Effect.succeed(new Date("2026-10-19T10:00:00.000Z")) },
    settings: {
      read: (organizationId) => Effect.succeed(organizationId === "org-1" ? row : undefined),
      write: (settings) => Effect.sync(() => {
        writes.push(settings)
        const openapiKey = settings.openapiKey.kind === "set" ? settings.openapiKey.key : settings.openapiKey.kind === "keep" ? row?.openapiKey : undefined
        row = { provider: settings.provider, version: settings.updatedAt, ...(openapiKey === undefined ? {} : { openapiKey }) }
      }),
    },
    providers,
    permissions: { lookup: lookupPermission, manageSettings: settingsPermission },
  })
  return { service, writes, calls }
}
const all = [lookupPermission, settingsPermission]
const failure = <Value, Failure>(effect: Effect.Effect<Value, Failure>) => Effect.runPromise(Effect.flip(effect))

void test("publishes an optional company-lookup plugin with its baseline and one permission", () => {
  assert.deepEqual([cube.manifest.name, cube.manifest.parent, cube.manifest.required], ["company-lookup", "invoicing", false])
  assert.deepEqual(cube.manifest.tables, ["company_lookup_settings"])
  assert.deepEqual(companyLookupMigrations.map(({ name }) => name), ["company-lookup-001-baseline"])
  assert.deepEqual(cube.manifest.permissions.map(({ name }) => name), ["company-lookup:company.lookup"])
})

void test("company.lookup goes to exactly the roles that manage customers, drafts or settings", () => {
  const invoicingNames = invoicingPermissions("invoicing")
  const editing = new Set([invoicingNames.manageCustomers, invoicingNames.draftInvoices, invoicingNames.manageSettings])
  const roles = new Set(invoicing.manifest.permissions.filter(({ name }) => editing.has(name)).flatMap(({ roles }) => roles))
  assert.deepEqual([...new Set(cube.manifest.permissions.flatMap(({ roles }) => roles))].sort(), [...roles].sort())
})

void test("each operation refuses a caller without its permission", async () => {
  const { service, calls } = rig([], { provider: "anaf", version: "v1" })
  const lookupOnly = rig([lookupPermission], { provider: "anaf", version: "v1" }).service
  const settingsOnly = rig([settingsPermission], { provider: "anaf", version: "v1" }).service
  const refusals: ReadonlyArray<readonly [Effect.Effect<unknown, unknown>, string]> = [
    [service.getSettings, settingsPermission], [service.updateSettings({ provider: "none" }), settingsPermission],
    [service.availability, lookupPermission], [service.lookup("12345674"), lookupPermission], [service.search("Exemplu"), lookupPermission],
    [lookupOnly.getSettings, settingsPermission], [lookupOnly.updateSettings({ provider: "anaf" }), settingsPermission],
    [settingsOnly.lookup("12345674"), lookupPermission], [settingsOnly.search("Exemplu"), lookupPermission],
  ]
  for (const [operation, permission] of refusals) {
    const refused = await failure(operation)
    assert.ok(refused instanceof PermissionDenied && refused.permission === permission, permission)
  }
  assert.deepEqual(calls, [])
})

void test("settings start empty, take the provider and the key, and never show the key", async () => {
  const { service, writes } = rig(all)
  assert.deepEqual(await Effect.runPromise(service.getSettings), { provider: "none", openapiKeyConfigured: false, openapiKeyLast4: null })
  assert.ok(await failure(service.updateSettings({ provider: "openapi" })) instanceof ValidationFailure)
  assert.equal(writes.length, 0, "a refused update writes nothing")
  const saved = await Effect.runPromise(service.updateSettings({ provider: "openapi", openapiKey: key }))
  assert.deepEqual(saved, { provider: "openapi", openapiKeyConfigured: true, openapiKeyLast4: "wxyz" })
  assert.deepEqual(writes.map(({ organizationId, provider, updatedAt, updatedBy, openapiKey }) => [organizationId, provider, updatedAt, updatedBy, openapiKey.kind]),
    [["org-1", "openapi", "2026-10-19T10:00:00.000Z", "user-1", "set"]])
  assert.deepEqual(await Effect.runPromise(service.getSettings), saved)
  assert.deepEqual(await Effect.runPromise(service.updateSettings({ provider: "anaf", clearOpenapiKey: true })),
    { provider: "anaf", openapiKeyConfigured: false, openapiKeyLast4: null })
})

void test("availability tells the forms the provider, name search and thresholds", async () => {
  assert.deepEqual(await Effect.runPromise(rig([lookupPermission]).service.availability),
    { provider: "none", nameSearch: false, minCuiDigits: 4, minNameLetters: 6 })
  assert.equal((await Effect.runPromise(rig([lookupPermission], { provider: "anaf", version: "v1" }).service.availability)).nameSearch, false)
  assert.equal((await Effect.runPromise(rig([lookupPermission], { provider: "openapi", openapiKey: key, version: "v1" }).service.availability)).nameSearch, true)
})

void test("a refused query or a missing provider never reaches a provider", async () => {
  const anaf = rig([lookupPermission], { provider: "anaf", version: "v1" })
  for (const query of ["124", "12345675", "RO12A"]) assert.ok(await failure(anaf.service.lookup(query)) instanceof ValidationFailure, query)
  assert.ok(await failure(anaf.service.search("Exe 12")) instanceof ValidationFailure)
  const none = rig([lookupPermission])
  const notConfigured = await failure(none.service.lookup("12345674"))
  assert.ok(notConfigured instanceof DomainConflict && notConfigured.code === "company_lookup_not_configured")
  const switchedOff = rig([lookupPermission], { provider: "none", version: "v1" })
  for (const unset of [none, switchedOff]) {
    const refused = await failure(unset.service.search("Exemplu"))
    assert.ok(refused instanceof DomainConflict && refused.code === "company_lookup_not_configured")
  }
  const noSearch = await failure(anaf.service.search("Exemplu"))
  assert.ok(noSearch instanceof DomainConflict && noSearch.code === "company_search_unavailable")
  assert.deepEqual([...anaf.calls, ...none.calls, ...switchedOff.calls], [])
})

void test("lookups go to the configured provider and come back as proposals", async () => {
  const anaf = rig([lookupPermission], { provider: "anaf", version: "v1" })
  assert.equal((await Effect.runPromise(anaf.service.lookup(" RO12345674 "))).name, "EXEMPLU TEST SRL")
  assert.ok(await failure(anaf.service.lookup("1235")) instanceof ResourceNotFound)
  assert.deepEqual(anaf.calls, ["anaf:12345674", "anaf:1235"])
  const openapi = rig([lookupPermission], { provider: "openapi", openapiKey: key, version: "v2" })
  assert.equal((await Effect.runPromise(openapi.service.lookup("12345674"))).cui, "12345674")
  assert.deepEqual(await Effect.runPromise(openapi.service.search(" Exemplu ")), [{ cui: "12345674", name: "EXEMPLU TEST SRL" }])
  assert.deepEqual(openapi.calls, ["openapi:12345674:sk_test_0123456789wxyz", "search:Exemplu"])
})

void test("a provider failure passes through untouched, from lookup and from search", async () => {
  const failing = (provider: "anaf" | "openapi") => createCompanyLookupService({
    context: { current: Effect.succeed({ identity: { id: "u", username: "u", roles: [], permissions: [lookupPermission] }, organization: { id: "org-1" } }) },
    clock: { now: Effect.succeed(new Date()) },
    settings: { read: () => Effect.succeed({ provider, openapiKey: key, version: "v1" }), write: () => Effect.void },
    providers: { anaf: { lookup: () => Effect.fail(new ProviderFailure({ reason: "unavailable" })) },
      openapi: { lookup: () => Effect.succeed(undefined),
        search: () => Effect.fail(new ProviderFailure({ reason: "quota_exceeded", retryAfterSeconds: 30 })) } },
    permissions: { lookup: lookupPermission, manageSettings: settingsPermission },
  })
  const lookup = await failure(failing("anaf").lookup("12345674"))
  assert.ok(lookup instanceof ProviderFailure && lookup.reason === "unavailable")
  const search = await failure(failing("openapi").search("Exemplu"))
  assert.ok(search instanceof ProviderFailure)
  assert.deepEqual([search.reason, search.retryAfterSeconds], ["quota_exceeded", 30])
})
