import assert from "node:assert/strict"
import test from "node:test"

import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToString } from "react-dom/server"

import { AuthContext, type AuthController } from "./auth-context.ts"
import { companyLookupAvailabilityQuery, companyLookupQuery, companySearchQuery } from "./company-lookup-queries.ts"
import { useCompanyLookup } from "./use-company-lookup.ts"
import type { PluginName } from "../lib/api-contracts.ts"
import { createBrowserTransport } from "../lib/browser-transport.ts"
import { createCompanyLookupClient } from "../lib/company-lookup-client.ts"
import type { CompanyLookupAvailability } from "../lib/company-lookup-model.ts"
import { cuiLookupQuery, nameSearchQuery, usableAvailability } from "../lib/company-lookup-query.ts"

/**
 * What the three forms ask of the company-lookup routes. `renderToString` runs
 * the hook once but subscribes nothing, so the "nothing is fetched" proofs are
 * subscribed `QueryObserver`s on a transport that counts every request, built
 * from the same rules the hook composes.
 */
const proposal = { name: "Exemplu SRL", cui: "13548146", vatRegistered: true, deregistered: false, address: { county: "RO-B" } }
const anaf: CompanyLookupAvailability = { provider: "anaf", nameSearch: false, minCuiDigits: 4, minNameLetters: 6 }
const openapi: CompanyLookupAvailability = { ...anaf, provider: "openapi", nameSearch: true }

const countingTransport = (answer: unknown) => {
  const requested: Array<{ readonly path: string; readonly init: RequestInit | undefined }> = []
  const transport = createBrowserTransport({
    fetch: (input, init) => { requested.push({ path: typeof input === "string" ? input : "not-a-path", init }); return Promise.resolve(Response.json(answer)) },
    onUnauthorized: () => undefined,
  })
  return { client: createCompanyLookupClient(transport), transport, requested }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

interface Watchable<Data> {
  readonly subscribe: (listener: () => void) => () => void
  readonly getCurrentResult: () => { readonly data: Data | undefined }
}

// The answers carry a `gcTime`, whose timer would keep the test process alive: each read gets its own client, cleared after.
const observe = async <Data>(read: (queryClient: QueryClient) => Watchable<Data>) => {
  const queryClient = new QueryClient()
  const observer = read(queryClient)
  const stop = observer.subscribe(() => undefined)
  await settle()
  stop()
  queryClient.clear()
  return observer.getCurrentResult()
}

const authWith = (plugins: ReadonlyArray<PluginName>, transport: AuthController["transport"]): AuthController => ({
  status: "authenticated", error: undefined, loginPending: false, logoutPending: false, plugins,
  login: () => Promise.resolve(), logout: () => Promise.resolve(), retryRestore: () => Promise.resolve(),
  transport, csrfToken: () => "csrf-1", epoch: () => 1, ownsEpoch: () => true,
})

void test("plugin off: availability is never asked", async () => {
  const { client, requested } = countingTransport(anaf)
  await observe((queryClient) => new QueryObserver(queryClient, companyLookupAvailabilityQuery(client, false)))
  assert.equal(requested.length, 0)
  const on = await observe((queryClient) => new QueryObserver(queryClient, companyLookupAvailabilityQuery(client, true)))
  assert.deepEqual([requested.map((request) => request.path), on.data], [["/api/company-lookup/availability"], anaf])
})

void test("provider none, a refused availability, or a CUI under the threshold: no lookup leaves", async () => {
  const { client, requested } = countingTransport(proposal)
  const none = usableAvailability({ data: { ...anaf, provider: "none" }, isPending: false, error: null })
  for (const cui of [cuiLookupQuery(none, "13548146"), cuiLookupQuery(anaf, "108"), cuiLookupQuery(anaf, "13548147")]) {
    await observe((queryClient) => new QueryObserver(queryClient, companyLookupQuery(client, () => "csrf-1", "anaf", cui)))
  }
  assert.equal(requested.length, 0)
})

void test("an eligible CUI is one POST with CSRF and the normalized body; the answer is decoded", async () => {
  const { client, requested } = countingTransport(proposal)
  const result = await observe((queryClient) => new QueryObserver(queryClient, companyLookupQuery(client, () => "csrf-1", "anaf", cuiLookupQuery(anaf, "RO13548146"))))
  assert.deepEqual(result.data, proposal)
  assert.deepEqual(requested.map((request) => request.path), ["/api/company-lookup/lookup"])
  const init = requested[0]?.init ?? {}
  assert.equal(init.method, "POST")
  assert.equal(new Headers(init.headers).get("x-csrf-token"), "csrf-1")
  assert.deepEqual(JSON.parse(typeof init.body === "string" ? init.body : ""), { cui: "13548146" })
})

void test("suggestions only with nameSearch, and only from six letters", async () => {
  const { client, requested } = countingTransport({ items: [{ cui: "13548146", name: "Exemplu SRL" }] })
  await observe((queryClient) => new QueryObserver(queryClient, companySearchQuery(client, () => "csrf-1", "anaf", nameSearchQuery(anaf, "Exemplu Construct"))))
  await observe((queryClient) => new QueryObserver(queryClient, companySearchQuery(client, () => "csrf-1", "openapi", nameSearchQuery(openapi, "Exemp"))))
  assert.equal(requested.length, 0)
  const found = await observe((queryClient) => new QueryObserver(queryClient, companySearchQuery(client, () => "csrf-1", "openapi", nameSearchQuery(openapi, "Exemplu"))))
  assert.deepEqual(found.data, [{ cui: "13548146", name: "Exemplu SRL" }])
  assert.deepEqual(requested.map((request) => request.path), ["/api/company-lookup/search"])
  assert.deepEqual(JSON.parse(typeof requested[0]?.init?.body === "string" ? requested[0].init.body : ""), { q: "Exemplu" })
})

void test("the hook: plugin off or not a company offers nothing; a fresh form is idle", () => {
  const render = (plugins: ReadonlyArray<PluginName>, company: boolean) => {
    const { transport } = countingTransport(anaf)
    let model: ReturnType<typeof useCompanyLookup>["lookup"] | undefined
    const Probe = () => { model = useCompanyLookup("new:company", company).lookup; return null }
    const queryClient = new QueryClient()
    renderToString(createElement(QueryClientProvider, { client: queryClient },
      createElement(AuthContext, { value: authWith(plugins, transport) }, createElement(Probe))))
    queryClient.clear()
    return model
  }
  for (const [plugins, company] of [[[], true], [["company-lookup"], false], [["company-lookup"], true]] as const) {
    const model = render(plugins, company)
    assert.deepEqual([model?.nameSearch, model?.outcome, model?.suggestions, model?.searchNote], [false, { kind: "idle" }, [], undefined])
  }
})
