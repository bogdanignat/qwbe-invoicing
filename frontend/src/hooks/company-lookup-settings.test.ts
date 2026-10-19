import assert from "node:assert/strict"
import test from "node:test"

import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToString } from "react-dom/server"

import { AuthContext, type AuthController } from "./auth-context.ts"
import { adoptSavedSettings, companyLookupSettingsQuery, useCompanyLookupSettings } from "./use-company-lookup-settings.ts"
import type { PluginName } from "../lib/api-contracts.ts"
import { createBrowserTransport } from "../lib/browser-transport.ts"
import { companyLookupQueryKeys, createCompanyLookupClient } from "../lib/company-lookup-client.ts"
import { pluginActive } from "../lib/plugins.ts"

const answer = { provider: "anaf", openapiKeyConfigured: true, openapiKeyLast4: "wxyz" }

const countingTransport = () => {
  const requested: Array<{ readonly path: string; readonly init: RequestInit | undefined }> = []
  const transport = createBrowserTransport({
    fetch: (input, init) => { requested.push({ path: typeof input === "string" ? input : "not-a-path", init }); return Promise.resolve(Response.json(answer)) },
    onUnauthorized: () => undefined,
  })
  return { transport, requested }
}

const authWith = (plugins: ReadonlyArray<PluginName>, transport: AuthController["transport"]): AuthController => ({
  status: "authenticated", error: undefined, loginPending: false, logoutPending: false, plugins,
  login: () => Promise.resolve(), logout: () => Promise.resolve(), retryRestore: () => Promise.resolve(),
  transport, csrfToken: () => "csrf", epoch: () => 1, ownsEpoch: () => true,
})

const renderModel = (plugins: ReadonlyArray<PluginName>) => {
  const { transport } = countingTransport()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let model: ReturnType<typeof useCompanyLookupSettings> | undefined
  const Probe = () => { model = useCompanyLookupSettings(); return null }
  renderToString(createElement(QueryClientProvider, { client: queryClient },
    createElement(AuthContext, { value: authWith(plugins, transport) }, createElement(Probe))))
  return model
}

void test("company-lookup off: Integrări is hidden, the model says off", () => {
  assert.equal(renderModel([])?.load.kind, "off")
  assert.equal(renderModel(["payments", "efactura"])?.load.kind, "off")
  assert.equal(renderModel(["company-lookup"])?.load.kind, "loading")
})

void test("company-lookup off: the settings read never leaves; on, it reaches exactly its route", async () => {
  const observe = async (plugins: ReadonlyArray<PluginName>) => {
    const { transport, requested } = countingTransport()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const enabled = pluginActive({ status: "authenticated", plugins }, "company-lookup")
    const observer = new QueryObserver(queryClient, companyLookupSettingsQuery(createCompanyLookupClient(transport), enabled))
    const stop = observer.subscribe(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 10))
    await queryClient.invalidateQueries({ queryKey: ["company-lookup"] })
    await new Promise((resolve) => setTimeout(resolve, 10))
    stop()
    return { paths: [...new Set(requested.map((request) => request.path))], data: observer.getCurrentResult().data }
  }
  assert.deepEqual(await observe([]), { paths: [], data: undefined })
  assert.deepEqual(await observe(["payments"]), { paths: [], data: undefined })
  assert.deepEqual(await observe(["company-lookup"]), { paths: ["/api/settings/company-lookup"], data: answer })
})

void test("the write is a PUT with CSRF and the body the rule decided; the answer is decoded", async () => {
  const { transport, requested } = countingTransport()
  const saved = await createCompanyLookupClient(transport).saveSettings("csrf-1", { provider: "anaf", openapiKey: "abcdefghijwxyz" })
  assert.deepEqual(saved, answer)
  assert.deepEqual(requested.map((request) => request.path), ["/api/settings/company-lookup"])
  const init = requested[0]?.init ?? {}
  assert.equal(init.method, "PUT")
  assert.equal(new Headers(init.headers).get("x-csrf-token"), "csrf-1")
  assert.deepEqual(JSON.parse(typeof init.body === "string" ? init.body : ""), { provider: "anaf", openapiKey: "abcdefghijwxyz" })
})

void test("a saved setting becomes the read and sends the forms back to availability", () => {
  const queryClient = new QueryClient()
  queryClient.setQueryData(companyLookupQueryKeys.availability, { provider: "none" })
  adoptSavedSettings(queryClient, { provider: "openapi", openapiKeyConfigured: true, openapiKeyLast4: "wxyz" })
  assert.deepEqual(queryClient.getQueryData(companyLookupQueryKeys.settings),
    { provider: "openapi", openapiKeyConfigured: true, openapiKeyLast4: "wxyz" })
  assert.equal(queryClient.getQueryState(companyLookupQueryKeys.availability)?.isInvalidated, true)
})
