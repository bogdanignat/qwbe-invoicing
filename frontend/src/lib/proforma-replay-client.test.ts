import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import { createProformaReplayClient, decodeProformaIdentity } from "./proforma-replay-client.ts"
import { UnreadableAnswer } from "./unreadable-answer.ts"
import type { BrowserTransport, TransportOptions } from "./browser-transport.ts"

/**
 * The three endpoints a stored proforma intent can be sent to again.
 *
 * A replay is only idempotent if it reaches the same path, with the same
 * method, carrying the same key the server recognises it by. None of that is
 * visible to the replay controller's tests, which mock this client away, so it
 * is asserted here at the transport boundary: a wrong path is a 404 the
 * controller reads as a permanent failure, and a missing key would author a
 * second document.
 */

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

const customer = {
  partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false,
  address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 },
}

const draft = {
  id: "draft-1", organizationId: "org", customer,
  sourceProformaId: "prf-1", series: "FCT", issueDate: "2026-01-01", dueDate: null, currency: "RON",
  notes: null, status: "draft", lines: [], vatBreakdown: [],
  totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
}

const issuedInvoice = {
  id: "inv-1", series: "FCT", number: 12, issueDate: "2026-01-01", dueDate: null, notes: null,
  currency: "RON", eFacturaStatus: "not_sent",
  issuer: {
    name: "Beta", fiscalIdentifier: "321", legalForm: "srl", tradeRegistryNumber: "J40/1/2020",
    iban: "RO00XXXX0000000000", bankName: "Banca", socialCapital: "100.00", vatRegistered: true,
    address: customer.address,
  },
  customer, lines: [], vatBreakdown: [],
  totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
}

const answerFor = (call: Call): unknown => {
  if (call.path.endsWith("/invoice")) return issuedInvoice
  if (call.path.endsWith("/draft-invoice")) return draft
  return { id: "prf-1" }
}

const sent = (call: Call | undefined): ReadonlyArray<unknown> => {
  if (call === undefined || call.options === undefined) throw new Error("expected a write call")
  return [call.path, call.options.method, call.options.csrfToken, call.options.idempotencyKey]
}

void test("each proforma replay hits its own endpoint as a POST, under the stored key", async () => {
  const { calls, transport } = recorder(answerFor)
  const client = createProformaReplayClient(transport)
  const proforma = await client.replayProformaIssuance("csrf-1", { series: "PRO" }, "key-1")
  assert.equal(proforma.id, "prf-1")
  assert.deepEqual(sent(calls[0]), ["/api/proformas", "POST", "csrf-1", "key-1"])

  const invoice = await client.replayInvoiceFromProforma("csrf-1", "prf-1", { invoiceSeries: "FCT" }, "key-2")
  assert.equal(invoice.id, "inv-1")
  assert.deepEqual(sent(calls[1]), ["/api/proformas/prf-1/invoice", "POST", "csrf-1", "key-2"])

  const converted = await client.replayDraftFromProforma("csrf-1", "prf-1", { invoiceSeries: "FCT" }, "key-3")
  assert.equal(converted.sourceProformaId, "prf-1")
  assert.deepEqual(sent(calls[2]), ["/api/proformas/prf-1/draft-invoice", "POST", "csrf-1", "key-3"])
})

void test("the proforma id travels encoded: it is a path segment, not a path", async () => {
  const { calls, transport } = recorder(answerFor)
  const client = createProformaReplayClient(transport)
  await client.replayInvoiceFromProforma("csrf", "prf 1/a", {}, "key-1")
  await client.replayDraftFromProforma("csrf", "prf 1/a", {}, "key-2")
  assert.deepEqual(
    [calls[0]?.path, calls[1]?.path],
    ["/api/proformas/prf%201%2Fa/invoice", "/api/proformas/prf%201%2Fa/draft-invoice"],
  )
})

void test("a stored body that is null or absent is sent as an empty object, never as null", async () => {
  const { calls, transport } = recorder(answerFor)
  const client = createProformaReplayClient(transport)
  await client.replayProformaIssuance("csrf", null, "key-1")
  await client.replayInvoiceFromProforma("csrf", "prf-1", undefined, "key-2")
  // A literal `null` body would come back as a validation error, leaving the
  // key unresolved instead of replaying the write under it.
  assert.deepEqual([calls[0]?.options?.body, calls[1]?.options?.body], [{}, {}])
})

void test("the stored body is otherwise sent byte for byte", async () => {
  const body = { series: "PRO", lines: [{ description: "Consultanță" }] }
  const { calls, transport } = recorder(answerFor)
  const client = createProformaReplayClient(transport)
  await client.replayProformaIssuance("csrf", body, "key-1")
  assert.equal(calls[0]?.options?.body, body)
})

void test("a refusal from the server reaches the caller as it came", async () => {
  const conflict = new ApiFailure({ message: "cheie refolosită", status: 409, code: "idempotency_key_reused" })
  const { transport } = recorder(() => { throw conflict })
  const client = createProformaReplayClient(transport)
  await assert.rejects(client.replayInvoiceFromProforma("csrf", "prf-1", {}, "key-1"), (error: unknown) => {
    // Classified, not wrapped: the replay controller reads the code off it.
    assert.equal(error, conflict)
    return true
  })
})

void test("an answer that arrived but could not be read is an unknown outcome, not a failure", async () => {
  // A 2xx whose JSON drifted from the contract, on each of the three answers.
  const { transport } = recorder((call) => call.path === "/api/proformas" ? { id: 7 } : { ...issuedInvoice, series: 12 })
  const client = createProformaReplayClient(transport)
  // Every one of the three is a write: the document may exist on the server.
  await assert.rejects(client.replayInvoiceFromProforma("csrf", "prf-1", {}, "key-1"), UnreadableAnswer)
  await assert.rejects(client.replayDraftFromProforma("csrf", "prf-1", {}, "key-2"), UnreadableAnswer)
  await assert.rejects(client.replayProformaIssuance("csrf", {}, "key-3"), UnreadableAnswer)
})

void test("a proforma identity without an id is refused at the boundary", () => {
  assert.throws(() => decodeProformaIdentity({}), /invalid id/u)
  assert.throws(() => decodeProformaIdentity({ id: 7 }), /invalid id/u)
  assert.throws(() => decodeProformaIdentity(null), /expected object/u)
  assert.deepEqual(decodeProformaIdentity({ id: "prf-1", series: "PRO" }), { id: "prf-1" })
})
