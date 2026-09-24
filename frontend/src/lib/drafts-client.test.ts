import assert from "node:assert/strict"
import test from "node:test"

import { createAuthoringReferenceClient } from "./authoring-reference-client.ts"
import { createDraftsClient } from "./drafts-client.ts"
import { ApiFailure } from "./api-errors.ts"
import type { BrowserTransport, TransportOptions } from "./browser-transport.ts"

interface Call {
  readonly path: string
  readonly options: TransportOptions | undefined
}

const recorder = (answer: (call: Call) => unknown = () => ({})) => {
  const calls: Call[] = []
  const transport: BrowserTransport = {
    json: (path, options) => Promise.resolve().then(() => {
      calls.push({ path, options })
      return answer(calls[calls.length - 1] as Call)
    }),
    binary: () => { throw new Error("unscripted binary") },
  }
  return { calls, transport }
}

const unit = { code: "C62", name: "unitate" }
const draft = {
  id: "draft-1", organizationId: "org",
  customer: { partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false,
    address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 } },
  sourceProformaId: null, series: "FCT", issueDate: "2026-01-01", dueDate: null, currency: "RON",
  notes: null, status: "draft", lines: [], vatBreakdown: [],
  totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
}

void test("draft writes carry the CSRF token the session handed over", async () => {
  const { calls, transport } = recorder(() => draft)
  const client = createDraftsClient(transport)
  await client.createDraft("csrf-1", { series: "FCT", issueDate: "2026-01-01" } as never)
  const write = calls[0]
  if (write === undefined || write.options === undefined) throw new Error("expected a write call")
  assert.deepEqual(
    [write.path, write.options.method, write.options.csrfToken, write.options.idempotencyKey],
    ["/api/drafts", "POST", "csrf-1", undefined],
  )
})

void test("draft reads take the query's abort signal and no CSRF token", async () => {
  const { calls, transport } = recorder((call) => call.path.includes("?") ? { items: [draft], nextCursor: null } : draft)
  const client = createDraftsClient(transport)
  const signal = new AbortController().signal
  await client.getDraft("draft/1", signal)
  const read = calls[0]
  if (read === undefined || read.options === undefined) throw new Error("expected a read call")
  assert.deepEqual(
    [read.path, read.options.signal, read.options.csrfToken],
    ["/api/drafts/draft%2F1", signal, undefined],
  )
  await client.listDrafts({ limit: 25, cursor: "a b" }, signal)
  assert.equal(calls[1]?.path, "/api/drafts?limit=25&cursor=a+b")
})

const issuedInvoicePayload = {
  id: "inv-1", series: "FCT", number: 12, issueDate: "2026-01-01", dueDate: null, notes: null,
  currency: "RON", eFacturaStatus: "not_sent",
  issuer: { name: "Beta", fiscalIdentifier: "321", legalForm: "srl", tradeRegistryNumber: "J40/1/2020",
    iban: "RO00XXXX0000000000", bankName: "Banca", socialCapital: "100.00", vatRegistered: true,
    address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 } },
  customer: draft.customer, lines: [], vatBreakdown: [],
  totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
}

void test("issuance calls carry the idempotency key, other writes do not", async () => {
  const { calls, transport } = recorder((call) => call.path.endsWith("/issue") ? issuedInvoicePayload : draft)
  const client = createDraftsClient(transport)
  await client.issueDraft("csrf", "draft-1", "key-1")
  const issue = calls[0]
  if (issue === undefined || issue.options === undefined) throw new Error("expected an issue call")
  assert.deepEqual([issue.path, issue.options.idempotencyKey], ["/api/drafts/draft-1/issue", "key-1"])
  await client.addDraftLine("csrf", "draft-1", { description: "x", quantity: "1", unitPrice: "1", unitOfMeasure: unit, vatRateCode: "RO_STANDARD" })
  assert.equal(calls[1]?.options?.idempotencyKey, undefined)
})

void test("the issuer answers null when it has not been configured yet", async () => {
  const { transport } = recorder(() => { throw new ApiFailure({ message: "nu există", status: 404 }) })
  const client = createAuthoringReferenceClient(transport)
  assert.equal(await client.getIssuer(new AbortController().signal), null)
})

void test("any other issuer failure is the caller's error to see", async () => {
  const { transport } = recorder(() => { throw new ApiFailure({ message: "Interzis", status: 403 }) })
  const client = createAuthoringReferenceClient(transport)
  await assert.rejects(client.getIssuer(new AbortController().signal), ApiFailure)
})

void test("a malformed draft is refused at the boundary, not three components deep", async () => {
  const { transport } = recorder(() => ({ ...draft, status: "nu-este-un-status" }))
  const client = createDraftsClient(transport)
  await assert.rejects(client.getDraft("draft-1", new AbortController().signal), /status/u)
})

void test("the customer and preset registries page by cursor", async () => {
  const { calls, transport } = recorder(() => ({ items: [], nextCursor: null }))
  const client = createAuthoringReferenceClient(transport)
  const signal = new AbortController().signal
  await client.listCustomers({ limit: 200, cursor: "next" }, signal)
  assert.equal(calls[0]?.path, "/api/customers?limit=200&cursor=next")
  await client.listProductPresets(undefined, signal)
  assert.equal(calls[1]?.path, "/api/product-presets")
})

void test("the vat catalogue is decoded with its canonical treatments", async () => {
  const { calls, transport } = recorder(() => ({
    rates: [{ code: "RO_NON_VAT", rate: "0", vatCategoryCode: "O",
      vatExemptionReason: "Regim special de scutire conform art. 310 din Codul fiscal",
      kind: "non_vat", label: "Scutit", effectiveFrom: "2026-01-01" }],
  }))
  const client = createAuthoringReferenceClient(transport)
  const catalogue = await client.getVatCatalogue(new AbortController().signal)
  assert.equal(calls[0]?.path, "/api/vat-regimes")
  assert.equal(catalogue.rates[0]?.code, "RO_NON_VAT")
})
