import assert from "node:assert/strict"
import test from "node:test"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToString } from "react-dom/server"

import { AuthContext, type AuthController } from "./auth-context.ts"
import { referenceQueryKeys } from "./reference-queries.ts"
import { useSetupGaps } from "./use-setup-gaps.ts"
import type { PluginName } from "../lib/api-contracts.ts"
import { createBrowserTransport } from "../lib/browser-transport.ts"
import { companyLookupQueryKeys } from "../lib/company-lookup-client.ts"
import { efacturaQueryKeys } from "../lib/efactura-client.ts"

/**
 * The card reads what the settings screens already cached, under their keys:
 * seeded answers are enough to decide every row, with nothing fetched.
 */
const transport = createBrowserTransport({
  fetch: () => Promise.reject(new Error("nothing is fetched while rendering")), onUnauthorized: () => undefined,
})

const authWith = (plugins: ReadonlyArray<PluginName>): AuthController => ({
  status: "authenticated", error: undefined, loginPending: false, logoutPending: false, plugins,
  login: () => Promise.resolve(), logout: () => Promise.resolve(), retryRestore: () => Promise.resolve(),
  transport, csrfToken: () => "csrf", epoch: () => 1, ownsEpoch: () => true,
})

const gapsWith = (plugins: ReadonlyArray<PluginName>, seed: (client: QueryClient) => void) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seed(queryClient)
  let gaps: ReturnType<typeof useSetupGaps>
  const Probe = () => { gaps = useSetupGaps(); return null }
  renderToString(createElement(QueryClientProvider, { client: queryClient },
    createElement(AuthContext, { value: authWith(plugins) }, createElement(Probe))))
  return gaps?.map((row) => row.code)
}

const seedAll = (client: QueryClient): void => {
  client.setQueryData(referenceQueryKeys.issuer, null)
  client.setQueryData(referenceQueryKeys.documentSeries, [{ organizationId: "org", documentType: "invoice", series: "F" }])
  client.setQueryData(companyLookupQueryKeys.availability, { provider: "none", nameSearch: false, minCuiDigits: 2, minNameLetters: 3 })
  client.setQueryData(efacturaQueryKeys.connection, {
    status: "disconnected", environment: "test", verifiedCif: null, refreshExpiresAt: null,
    refreshExpiryWarning: false, connectedBy: null, connectedAt: null, attempt: "none",
  })
}

void test("the rows come from the settings screens' own cache entries", () => {
  assert.deepEqual(gapsWith(["company-lookup", "efactura"], seedAll),
    ["issuer", "proforma_series", "company_lookup", "anaf_disconnected"])
})

void test("with the plugins off their entries are ignored, and their reads do not hold the card back", () => {
  assert.deepEqual(gapsWith([], seedAll), ["issuer", "proforma_series"])
  assert.deepEqual(gapsWith(["payments"], (client) => {
    client.setQueryData(referenceQueryKeys.issuer, {})
    client.setQueryData(referenceQueryKeys.documentSeries, [])
  }), ["invoice_series", "proforma_series"])
})

void test("while a counted read has not answered there are no rows yet", () => {
  assert.equal(gapsWith(["efactura"], (client) => {
    client.setQueryData(referenceQueryKeys.issuer, null)
    client.setQueryData(referenceQueryKeys.documentSeries, [])
  }), undefined)
})
