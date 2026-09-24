import assert from "node:assert/strict"
import test from "node:test"

import { createInvoiceDocumentsClient, createInvoiceRegisterClient } from "./invoicing-clients.ts"
import { paged } from "./client-paths.ts"
import type { BrowserTransport, TransportOptions } from "./browser-transport.ts"

interface Call {
  readonly kind: "json" | "binary"
  readonly path: string
  readonly options: TransportOptions | undefined
}

const recorder = (answers: { json?: unknown; binary?: Blob } = {}) => {
  const calls: Array<Call> = []
  const transport: BrowserTransport = {
    json: (path, options) => {
      calls.push({ kind: "json", path, options })
      return Promise.resolve(answers.json)
    },
    binary: (path, options) => {
      calls.push({ kind: "binary", path, options })
      return Promise.resolve(answers.binary ?? new Blob([]))
    },
  }
  return { calls, transport }
}

const row = {
  kind: "invoice",
  id: "inv-1",
  series: "FCT",
  number: 12,
  issueDate: "2026-02-03",
  customer: { name: "Alfa SRL" },
  currency: "RON",
  totalIncludingVat: "1190.00",
  dueDate: null,
  eFacturaStatus: "sent",
}

void test("a page request with no cursor asks for the register's first page", () => {
  assert.equal(paged("/api/invoice-register", undefined), "/api/invoice-register")
  assert.equal(paged("/api/invoice-register", {}), "/api/invoice-register")
})

void test("limit and cursor travel as query parameters, url-encoded", () => {
  assert.equal(paged("/api/invoice-register", { limit: 25 }), "/api/invoice-register?limit=25")
  assert.equal(
    paged("/api/invoice-register", { limit: 25, cursor: "a b/c" }),
    "/api/invoice-register?limit=25&cursor=a+b%2Fc",
  )
})

void test("the register client decodes the page it fetched", async () => {
  const { calls, transport } = recorder({ json: { items: [row], nextCursor: "next" } })
  const page = await createInvoiceRegisterClient(transport).list({ limit: 2 }, AbortSignal.abort())
  assert.equal(page.items[0]?.id, "inv-1")
  assert.equal(page.nextCursor, "next")
  assert.equal(calls[0]?.path, "/api/invoice-register?limit=2")
})

// Following the cursor is the only way to reach later pages, so the cursor the
// previous page returned has to be the one the next request carries.
void test("the second page is requested with the cursor the first returned", async () => {
  const { calls, transport } = recorder({ json: { items: [], nextCursor: null } })
  const client = createInvoiceRegisterClient(transport)
  await client.list({ limit: 2 }, AbortSignal.abort())
  await client.list({ limit: 2, cursor: "next" }, AbortSignal.abort())
  assert.deepEqual(calls.map((call) => call.path), [
    "/api/invoice-register?limit=2",
    "/api/invoice-register?limit=2&cursor=next",
  ])
})

void test("the abort signal of the query reaches the transport", async () => {
  const { calls, transport } = recorder({ json: { items: [], nextCursor: null } })
  const controller = new AbortController()
  await createInvoiceRegisterClient(transport).list(undefined, controller.signal)
  assert.equal(calls[0]?.options?.signal, controller.signal)
})

void test("a register page the contract does not describe fails the request", async () => {
  const { transport } = recorder({ json: { items: [{ ...row, kind: "receipt" }], nextCursor: null } })
  await assert.rejects(
    () => createInvoiceRegisterClient(transport).list(undefined, AbortSignal.abort()),
    /invalid kind/u,
  )
})

void test("document identifiers are encoded into the path", async () => {
  const { calls, transport } = recorder()
  await createInvoiceDocumentsClient(transport).downloadInvoiceEFactura("a/b")
  assert.equal(calls[0]?.path, "/api/invoices/a%2Fb/efactura.xml")
})

// Rendering a PDF is a state change and needs the session's CSRF token; the
// byte fetch that follows is an ordinary read of what was just rendered.
void test("a PDF download renders first with the CSRF token, then fetches the bytes", async () => {
  const { calls, transport } = recorder()
  await createInvoiceDocumentsClient(transport).downloadInvoicePdf("inv-1", "csrf-token")
  assert.deepEqual(calls.map((call) => [call.kind, call.path]), [
    ["json", "/api/invoices/inv-1/pdf"],
    ["binary", "/api/invoices/inv-1/pdf"],
  ])
  assert.deepEqual(
    calls.map((call) => [call.options?.method, call.options?.csrfToken, call.options?.accept]),
    [
      ["POST", "csrf-token", undefined],
      [undefined, undefined, "application/pdf"],
    ],
  )
})

void test("an e-Factura download is a single read asking for XML", async () => {
  const { calls, transport } = recorder()
  const client = createInvoiceDocumentsClient(transport)
  await client.downloadInvoiceEFactura("inv-1")
  await client.downloadCorrectionEFactura("cor-1")
  assert.deepEqual(calls.map((call) => [call.kind, call.path, call.options?.accept]), [
    ["binary", "/api/invoices/inv-1/efactura.xml", "application/xml"],
    ["binary", "/api/corrections/cor-1/efactura.xml", "application/xml"],
  ])
  assert.deepEqual(calls.map((call) => call.options?.method), [undefined, undefined])
})

void test("a failed render is not followed by a fetch of stale bytes", async () => {
  const calls: Array<string> = []
  const transport: BrowserTransport = {
    json: (path) => {
      calls.push(path)
      return Promise.reject(new Error("render failed"))
    },
    binary: (path) => {
      calls.push(path)
      return Promise.resolve(new Blob([]))
    },
  }
  await assert.rejects(
    () => createInvoiceDocumentsClient(transport).downloadInvoicePdf("inv-1", "csrf-token"),
    /render failed/u,
  )
  assert.deepEqual(calls, ["/api/invoices/inv-1/pdf"])
})
