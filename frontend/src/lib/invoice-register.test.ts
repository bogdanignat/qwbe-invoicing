import assert from "node:assert/strict"
import test from "node:test"

import { decodeInvoiceRegisterPage, decodeInvoiceRegisterRow } from "./invoice-register.ts"

const invoice = {
  kind: "invoice",
  id: "inv-1",
  series: "FCT",
  number: 12,
  issueDate: "2026-02-03",
  customer: { name: "Alfa SRL" },
  currency: "RON",
  totalIncludingVat: "1190.00",
  dueDate: "2026-03-05",
  eFacturaStatus: "accepted",
}

const correction = {
  kind: "correction",
  id: "cor-1",
  series: "STR",
  number: 4,
  issueDate: "2026-02-10",
  customer: { name: "Alfa SRL" },
  currency: "RON",
  totalIncludingVat: "-1190.00",
  dueDate: null,
  eFacturaStatus: null,
  originalReference: { id: "inv-1", series: "FCT", number: 12 },
}

const without = (row: Readonly<Record<string, unknown>>, field: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== field))

void test("an invoice row decodes to the invoice arm of the union", () => {
  const row = decodeInvoiceRegisterRow(invoice)
  assert.equal(row.kind, "invoice")
  assert.equal(row.dueDate, "2026-03-05")
  assert.equal(row.eFacturaStatus, "accepted")
})

void test("an invoice without a due date keeps the null rather than losing the field", () => {
  const row = decodeInvoiceRegisterRow({ ...invoice, dueDate: null })
  assert.equal(row.dueDate, null)
})

void test("a correction row decodes with the invoice it reverses", () => {
  const row = decodeInvoiceRegisterRow(correction)
  assert.equal(row.kind, "correction")
  assert.equal(row.eFacturaStatus, null)
  assert.deepEqual(row.originalReference, { id: "inv-1", series: "FCT", number: 12 })
})

void test("a correction keeps the negative total the backend stored, unchanged", () => {
  assert.equal(decodeInvoiceRegisterRow(correction).totalIncludingVat, "-1190.00")
})

// The two kinds are mutually exclusive, and a row claiming both is a contract
// break the view would otherwise have to guess its way through.
void test("an invoice carrying a correction's reference is rejected", () => {
  assert.throws(
    () => decodeInvoiceRegisterRow({ ...invoice, originalReference: { id: "x", series: "S", number: 1 } }),
    /invalid originalReference/u,
  )
})

void test("a correction carrying an invoice's due date or status is rejected", () => {
  assert.throws(() => decodeInvoiceRegisterRow({ ...correction, dueDate: "2026-03-05" }), /invalid dueDate/u)
  assert.throws(() => decodeInvoiceRegisterRow({ ...correction, eFacturaStatus: "sent" }), /invalid eFacturaStatus/u)
})

void test("a correction without the invoice it reverses is rejected", () => {
  assert.throws(() => decodeInvoiceRegisterRow(without(correction, "originalReference")), /expected object/u)
})

void test("an unknown document kind is refused instead of rendered blank", () => {
  assert.throws(() => decodeInvoiceRegisterRow({ ...invoice, kind: "receipt" }), /invalid kind/u)
  assert.throws(() => decodeInvoiceRegisterRow({ ...invoice, kind: undefined }), /invalid kind/u)
})

void test("an e-Factura status outside the contract is refused", () => {
  assert.throws(() => decodeInvoiceRegisterRow({ ...invoice, eFacturaStatus: "queued" }), /invalid eFacturaStatus/u)
  assert.throws(() => decodeInvoiceRegisterRow({ ...invoice, eFacturaStatus: null }), /invalid eFacturaStatus/u)
})

void test("a fractional document number is refused", () => {
  assert.throws(() => decodeInvoiceRegisterRow({ ...invoice, number: 12.5 }), /invalid number/u)
})

void test("a missing customer name fails at the boundary, not in a cell", () => {
  assert.throws(() => decodeInvoiceRegisterRow({ ...invoice, customer: {} }), /invalid customer\.name/u)
})

void test("a page carries both kinds and the cursor for the next one", () => {
  const page = decodeInvoiceRegisterPage({ items: [invoice, correction], nextCursor: "cursor-2" })
  assert.deepEqual(page.items.map((row) => row.kind), ["invoice", "correction"])
  assert.equal(page.nextCursor, "cursor-2")
})

void test("the last page states a null cursor rather than omitting it", () => {
  assert.equal(decodeInvoiceRegisterPage({ items: [], nextCursor: null }).nextCursor, null)
  assert.throws(() => decodeInvoiceRegisterPage({ items: [] }), /invalid nextCursor/u)
})

void test("one unreadable row fails the page instead of being dropped from it", () => {
  assert.throws(
    () => decodeInvoiceRegisterPage({ items: [invoice, { ...correction, kind: "receipt" }], nextCursor: null }),
    /invalid kind/u,
  )
})

void test("a response that is not a page is refused", () => {
  assert.throws(() => decodeInvoiceRegisterPage([invoice]), /expected object/u)
  assert.throws(() => decodeInvoiceRegisterPage({ items: invoice, nextCursor: null }), /invalid items/u)
})
