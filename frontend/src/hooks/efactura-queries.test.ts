import assert from "node:assert/strict"
import test from "node:test"

import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToString } from "react-dom/server"

import { AuthContext, type AuthController } from "./auth-context.ts"
import { efacturaCandidatesQuery, efacturaHistoryQuery, invalidateEFacturaDocument } from "./efactura-queries.ts"
import { useEFacturaDocument } from "./use-efactura-document.ts"
import type { PluginName } from "../lib/api-contracts.ts"
import { ApiFailure } from "../lib/api-errors.ts"
import { createBrowserTransport, type BrowserTransport } from "../lib/browser-transport.ts"
import { createEFacturaClient, efacturaQueryKeys } from "../lib/efactura-client.ts"
import { ARCHIVE_POLL_MS, EFACTURA_POLL_MS } from "../lib/efactura-document.ts"

const submission = (state: string, archiveState = "none") => ({
  id: "sub-1", environment: "test", documentKind: "invoice", documentId: "inv-1", standard: "UBL", cif: "19999919",
  state, archiveState, uploadIndex: ["processing", "accepted", "rejected"].includes(state) ? "5001" : null, downloadId: null, errors: [], superseded: false,
  xmlSha256: "ab", xmlSize: 10, createdBy: "api-token", createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-19T10:00:00.000Z",
})
const historyOf = (state: string, archiveState = "none") =>
  ({ current: submission(state, archiveState), submissions: [submission(state, archiveState)], resubmissions: [] })

const countingTransport = (answer: unknown) => {
  const requested: Array<string> = []
  const transport = createBrowserTransport({
    fetch: (input) => { requested.push(typeof input === "string" ? input : "not-a-path"); return Promise.resolve(Response.json(answer)) },
    onUnauthorized: () => undefined,
  })
  return { transport, requested }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

void test("the history query polls closely until ANAF decided, every minute while only its answer is fetched, then stops", async () => {
  const cases = [
    ["processing", "none", EFACTURA_POLL_MS], ["queued", "none", EFACTURA_POLL_MS], ["accepted", "none", false],
    ["unknown", "none", false], ["accepted", "pending", ARCHIVE_POLL_MS], ["rejected", "stored", false],
  ] as const
  for (const [state, archive, interval] of cases) {
    const { transport } = countingTransport(historyOf(state, archive))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = efacturaHistoryQuery(createEFacturaClient(transport), "invoice", "inv-1", true)
    await queryClient.query(options)
    const query = queryClient.getQueryCache().find({ queryKey: options.queryKey })
    assert.ok(query !== undefined && typeof options.refetchInterval === "function")
    assert.equal(options.refetchInterval(query as never), interval, `${state}/${archive}`)
  }
})

void test("with the plugin off the history is never asked; the candidates only once a search names the submission", async () => {
  const { transport, requested } = countingTransport(historyOf("unknown"))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const client = createEFacturaClient(transport)
  const stops = [
    new QueryObserver(queryClient, efacturaHistoryQuery(client, "invoice", "inv-1", false)).subscribe(() => undefined),
    new QueryObserver(queryClient, efacturaCandidatesQuery(client, undefined, 1)).subscribe(() => undefined),
  ]
  await settle()
  for (const stop of stops) stop()
  assert.deepEqual(requested, [])
})

void test("a write refreshes the history, the connection, the document's head and the register", () => {
  const queryClient = new QueryClient()
  const keys = [efacturaQueryKeys.history("correction", "c-1"), efacturaQueryKeys.connection, ["correction", "c-1"], ["invoice-register"],
    ["correction", "c-1", "other"], efacturaQueryKeys.history("invoice", "c-1")]
  for (const key of keys) queryClient.setQueryData(key, 1)
  invalidateEFacturaDocument(queryClient, "correction", "c-1")
  const stale = keys.map((key) => queryClient.getQueryState(key)?.isInvalidated)
  assert.deepEqual(stale, [true, true, true, true, false, false])
})

const authWith = (plugins: ReadonlyArray<PluginName>, transport: BrowserTransport): AuthController => ({
  status: "authenticated", error: undefined, loginPending: false, logoutPending: false, plugins,
  login: () => Promise.resolve(), logout: () => Promise.resolve(), retryRestore: () => Promise.resolve(),
  transport, csrfToken: () => "csrf", epoch: () => 1, ownsEpoch: () => true,
})

const renderModel = (plugins: ReadonlyArray<PluginName>, state = "unknown", connectionError?: Error) => {
  const { transport } = countingTransport(historyOf(state))
  // A server render only reads the cache, so a failed connection read is seeded into it; `retryOnMount: false`
  // keeps the observer from reporting that failure as a fetch about to start.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  queryClient.setQueryData(efacturaQueryKeys.history("invoice", "inv-1"), {
    current: { ...submission(state), errors: [] }, submissions: [], resubmissions: [],
  })
  if (connectionError !== undefined) {
    queryClient.getQueryCache().build(queryClient, { queryKey: efacturaQueryKeys.connection })
      .setState({ status: "error", error: connectionError, errorUpdatedAt: 1, fetchStatus: "idle" })
  }
  let model: ReturnType<typeof useEFacturaDocument> | undefined
  const Probe = () => { model = useEFacturaDocument("invoice", "inv-1", { series: "FCT", number: 12 }); return null }
  renderToString(createElement(QueryClientProvider, { client: queryClient },
    createElement(AuthContext, { value: authWith(plugins, transport) }, createElement(Probe))))
  return model
}

void test("the document panel exists only with the plugin on, and an unknown submission is not sendable from it", () => {
  assert.equal(renderModel(["payments"]), undefined)
  const model = renderModel(["efactura"])
  assert.ok(model?.view !== undefined)
  assert.equal(model.view.status, "unknown")
  assert.equal(model.view.canSubmit, false)
  assert.equal(model.reconciliation.searched, false, "nothing is asked of ANAF until the user searches")
})

void test("while the connection is read the reason is „not known yet”, with no error", () => {
  const model = renderModel(["efactura"], "rejected")
  assert.ok(model?.view !== undefined)
  assert.equal(model.view.reason, "Starea conexiunii ANAF nu este cunoscută încă.")
  assert.equal(model.connectionError, undefined)
  assert.equal(model.view.canSubmit, false)
})

void test("a failed connection read reaches the model as a sentence, with a retry only when it may pass", () => {
  const transient = renderModel(["efactura"], "rejected", new ApiFailure({ message: "down", status: 503 }))
  assert.ok(transient?.view !== undefined)
  assert.equal(transient.connectionError?.message, "down")
  assert.equal(typeof transient.connectionRetry, "function")
  assert.match(transient.view.reason ?? "", /nu a putut fi citită/u)
  assert.equal(transient.view.canSubmit, false)
  const denied = renderModel(["efactura"], "rejected", new ApiFailure({ message: "no", status: 403 }))
  assert.ok(denied !== undefined)
  assert.match(denied.connectionError?.message ?? "", /^Nu ai permisiunea/u)
  assert.equal(denied.connectionRetry, undefined)
})
