import assert from "node:assert/strict"
import test from "node:test"

import { decodeInvoiceRegisterPage, projectInvoiceRegisterRow } from "./invoice-register.ts"

const customer = { name: "Client SRL" }

void test("strictly decodes invoice and correction register rows", () => {
  const page = decodeInvoiceRegisterPage({ items: [
    {
      kind: "invoice", id: "invoice-1", series: "QWBE", number: 10,
      issueDate: "2026-09-20", dueDate: "2026-10-20", customer,
      currency: "RON", totalIncludingVat: "121.00", eFacturaStatus: "not_sent",
    },
    {
      kind: "correction", id: "correction-1", series: "QWBE", number: 11,
      issueDate: "2026-09-21", dueDate: null, customer,
      currency: "RON", totalIncludingVat: "-121.00", eFacturaStatus: null,
      originalReference: { id: "invoice-1", series: "QWBE", number: 10 },
    },
  ], nextCursor: "next" })

  assert.equal(page.items[0]?.kind, "invoice")
  assert.equal(page.items[1]?.kind, "correction")
  assert.equal(page.nextCursor, "next")
})

void test("rejects malformed rows, unknown kinds, and null invoice e-Factura status", () => {
  assert.throws(() => decodeInvoiceRegisterPage({ items: [{ kind: "receipt" }], nextCursor: null }), /invalid kind/)
  assert.throws(() => decodeInvoiceRegisterPage({ items: [{
    kind: "correction", id: "correction-1", series: "QWBE", number: 11,
    issueDate: "2026-09-21", dueDate: "2026-10-21", customer,
    currency: "RON", totalIncludingVat: "-121.00", eFacturaStatus: null,
    originalReference: { id: "invoice-1", series: "QWBE", number: 10 },
  }], nextCursor: null }), /invalid dueDate/)
  assert.throws(() => decodeInvoiceRegisterPage({ items: [{
    kind: "invoice", id: "invoice-1", series: "QWBE", number: 10,
    issueDate: "2026-09-20", dueDate: "2026-10-20", customer,
    currency: "RON", totalIncludingVat: "121.00", eFacturaStatus: "not_sent",
    originalReference: { id: "invoice-1", series: "QWBE", number: 10 },
  }], nextCursor: null }), /invalid originalReference/)
  for (const eFacturaStatus of [null, "unknown"]) {
    assert.throws(() => decodeInvoiceRegisterPage({ items: [{
      kind: "invoice", id: "invoice-1", series: "QWBE", number: 10,
      issueDate: "2026-09-20", dueDate: null, customer,
      currency: "RON", totalIncludingVat: "0.00", eFacturaStatus,
    }], nextCursor: null }), /invalid eFacturaStatus/)
  }
})

void test("projects correction identity, negative total, and only the original invoice link", () => {
  const [row] = decodeInvoiceRegisterPage({ items: [{
    kind: "correction", id: "correction/1", series: "QWBE", number: 11,
    issueDate: "2026-09-21", dueDate: null, customer,
    currency: "RON", totalIncludingVat: "-121.00", eFacturaStatus: null,
    originalReference: { id: "invoice/1", series: "QWBE", number: 10 },
  }], nextCursor: null }).items
  assert.ok(row)

  assert.deepEqual(projectInvoiceRegisterRow(row), {
    key: "correction:correction/1", number: "QWBE 11", kindLabel: "Storno",
    documentHref: null, customerName: "Client SRL", issueDate: "2026-09-21",
    dueDate: "—", total: "-121.00 RON", status: "—",
    originalInvoice: { label: "Factura inițială QWBE/10", href: "/invoices/invoice%2F1" },
  })
})

void test("decodes and projects a zero-total invoice with no due date", () => {
  const [row] = decodeInvoiceRegisterPage({ items: [{
    kind: "invoice", id: "invoice/1", series: "QWBE", number: 10,
    issueDate: "2026-09-20", dueDate: null, customer,
    currency: "RON", totalIncludingVat: "0.00", eFacturaStatus: "not_sent",
  }], nextCursor: null }).items
  assert.ok(row)

  assert.deepEqual(projectInvoiceRegisterRow(row), {
    key: "invoice:invoice/1", number: "QWBE 10", kindLabel: null,
    documentHref: "/invoices/invoice%2F1", customerName: "Client SRL", issueDate: "2026-09-20",
    dueDate: "—", total: "0.00 RON", status: "not_sent", originalInvoice: null,
  })
})
