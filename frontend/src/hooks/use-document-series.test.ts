import assert from "node:assert/strict"
import test from "node:test"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToString } from "react-dom/server"

import { AuthContext, type AuthController } from "./auth-context.ts"
import { referenceQueryKeys } from "./reference-queries.ts"
import { useDocumentSeries, type DocumentSeriesModel } from "./use-document-series.ts"
import { createBrowserTransport } from "../lib/browser-transport.ts"
import type { DocumentSeries } from "../lib/draft-models.ts"

const fct: DocumentSeries = { organizationId: "org", documentType: "invoice", series: "FCT", archived: false }

interface Sent { readonly path: string; readonly method: string | undefined; readonly body: unknown; readonly csrf: string | undefined }

const render = (owns: boolean) => {
  const sent: Array<Sent> = []
  const transport = createBrowserTransport({
    onUnauthorized: () => undefined,
    fetch: (input, init) => {
      const headers = init?.headers as Record<string, string> | undefined
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined
      sent.push({ path: typeof input === "string" ? input : "unexpected request", method: init?.method, body, csrf: headers?.["x-csrf-token"] })
      return Promise.resolve(new Response(JSON.stringify({ ...fct, archived: true }), {
        status: 200, headers: { "content-type": "application/json" },
      }))
    },
  })
  const auth: AuthController = {
    status: "authenticated", error: undefined, loginPending: false, logoutPending: false, plugins: [],
    login: () => Promise.resolve(), logout: () => Promise.resolve(), retryRestore: () => Promise.resolve(),
    transport, csrfToken: () => "csrf", epoch: () => 1, ownsEpoch: () => owns,
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(referenceQueryKeys.documentSeries, [fct])
  let model: DocumentSeriesModel | undefined
  const Probe = () => { model = useDocumentSeries(); return null }
  renderToString(createElement(QueryClientProvider, { client: queryClient },
    createElement(AuthContext, { value: auth }, createElement(Probe))))
  return { model, queryClient, sent }
}

const settled = async (queryClient: QueryClient): Promise<void> => {
  while (queryClient.isMutating() > 0) await new Promise((resolve) => setImmediate(resolve))
}

void test("the toggle sends the opposite state, signed, and refreshes the shared series list", async () => {
  const { model, queryClient, sent } = render(true)
  assert.equal(model?.archiving, undefined)
  model?.toggleArchived(fct)
  await settled(queryClient)
  assert.deepEqual(sent, [{ path: "/api/document-series/invoice/FCT/archived", method: "PUT", body: { archived: true }, csrf: "csrf" }])
  assert.equal(queryClient.getQueryState(referenceQueryKeys.documentSeries)?.isInvalidated, true)
})

void test("an answer that outlived its session refreshes nothing", async () => {
  const { model, queryClient, sent } = render(false)
  model?.toggleArchived(fct)
  await settled(queryClient)
  assert.equal(sent.length, 1)
  assert.equal(queryClient.getQueryState(referenceQueryKeys.documentSeries)?.isInvalidated, false)
})
