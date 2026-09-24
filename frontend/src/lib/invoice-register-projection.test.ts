import assert from "node:assert/strict"
import test from "node:test"

import {
  correctionDetailHref, emptyRegisterFilter, filterInvoiceRegisterRows, invoiceDetailHref,
  projectInvoiceRegisterRow,
} from "./invoice-register-projection.ts"
import type {
  InvoiceRegisterCorrectionRow, InvoiceRegisterInvoiceRow, InvoiceRegisterRow,
} from "./invoice-register.ts"

const invoice: InvoiceRegisterInvoiceRow = {
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

const correction: InvoiceRegisterCorrectionRow = {
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

void test("an invoice projects to its own detail route", () => {
  const row = projectInvoiceRegisterRow(invoice)
  assert.equal(row.documentHref, "/invoices/inv-1")
  assert.equal(row.kindLabel, null)
  assert.equal(row.originalInvoice, null)
  assert.equal(row.number, "FCT 12")
  assert.equal(row.total, "1190.00 RON")
  assert.equal(row.status, "Acceptată")
})

// A correction is a document of its own, not a second view of the invoice: its
// row links to `/corrections/{id}` and offers the original as a separate link.
void test("a correction projects to the correction route and names its original", () => {
  const row = projectInvoiceRegisterRow(correction)
  assert.equal(row.documentHref, "/corrections/cor-1")
  assert.equal(row.kindLabel, "Storno")
  assert.deepEqual(row.originalInvoice, { label: "Factura inițială FCT 12", href: "/invoices/inv-1" })
})

void test("a correction's negative total is shown as stored, not flipped", () => {
  assert.equal(projectInvoiceRegisterRow(correction).total, "-1190.00 RON")
})

void test("fields a correction never has read as a dash instead of blank", () => {
  const row = projectInvoiceRegisterRow(correction)
  assert.equal(row.dueDate, "—")
  assert.equal(row.status, "—")
})

void test("an invoice without a due date also reads as a dash", () => {
  assert.equal(projectInvoiceRegisterRow({ ...invoice, dueDate: null }).dueDate, "—")
})

void test("each e-Factura status has a Romanian label", () => {
  const labels = (["not_sent", "pending", "sent", "accepted", "rejected"] as const)
    .map((status) => projectInvoiceRegisterRow({ ...invoice, eFacturaStatus: status }).status)
  assert.deepEqual(labels, ["Netrimisă", "În curs", "Trimisă", "Acceptată", "Respinsă"])
})

// The two kinds are numbered independently, so an invoice and a correction can
// share an id; the row key has to carry the kind as well to stay unique.
void test("row keys stay distinct when the two kinds share an id", () => {
  assert.equal(projectInvoiceRegisterRow({ ...invoice, id: "same" }).key, "invoice:same")
  assert.equal(projectInvoiceRegisterRow({ ...correction, id: "same" }).key, "correction:same")
})

void test("an identifier that is not path-safe is encoded into the href", () => {
  assert.equal(invoiceDetailHref("a/b?c"), "/invoices/a%2Fb%3Fc")
  assert.equal(correctionDetailHref("a/b?c"), "/corrections/a%2Fb%3Fc")
})

const rows: ReadonlyArray<InvoiceRegisterRow> = [
  invoice,
  correction,
  { ...invoice, id: "inv-2", number: 13, customer: { name: "Beta Impex" } },
]

void test("the empty filter narrows nothing", () => {
  assert.deepEqual(filterInvoiceRegisterRows(rows, emptyRegisterFilter), rows)
})

void test("the kind filter keeps one document kind", () => {
  const invoices = filterInvoiceRegisterRows(rows, { kind: "invoice", search: "" })
  assert.deepEqual(invoices.map((row) => row.id), ["inv-1", "inv-2"])
  const corrections = filterInvoiceRegisterRows(rows, { kind: "correction", search: "" })
  assert.deepEqual(corrections.map((row) => row.id), ["cor-1"])
})

void test("the search matches series, number and customer, ignoring case and padding", () => {
  assert.deepEqual(
    filterInvoiceRegisterRows(rows, { kind: "all", search: "  beta  " }).map((row) => row.id),
    ["inv-2"],
  )
  assert.deepEqual(
    filterInvoiceRegisterRows(rows, { kind: "all", search: "STR 4" }).map((row) => row.id),
    ["cor-1"],
  )
  assert.deepEqual(
    filterInvoiceRegisterRows(rows, { kind: "all", search: "fct 13" }).map((row) => row.id),
    ["inv-2"],
  )
})

void test("the two filters combine rather than replacing one another", () => {
  assert.deepEqual(
    filterInvoiceRegisterRows(rows, { kind: "invoice", search: "alfa" }).map((row) => row.id),
    ["inv-1"],
  )
  assert.deepEqual(filterInvoiceRegisterRows(rows, { kind: "correction", search: "beta" }), [])
})

void test("a search nothing matches yields no rows rather than all of them", () => {
  assert.deepEqual(filterInvoiceRegisterRows(rows, { kind: "all", search: "gamma" }), [])
})
