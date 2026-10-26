import assert from "node:assert/strict"
import test from "node:test"

import { correctionDetailHref, invoiceDetailHref, projectInvoiceRegisterRow } from "./invoice-register-projection.ts"
import type { InvoiceRegisterCorrectionRow, InvoiceRegisterInvoiceRow } from "./invoice-register.ts"

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
  assert.equal(row.total, "1,190.00 RON")
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
  assert.equal(projectInvoiceRegisterRow(correction).total, "-1,190.00 RON")
})

void test("a correction's due date, and its status with e-Factura off, read as a dash instead of blank", () => {
  const row = projectInvoiceRegisterRow(correction)
  assert.equal(row.dueDate, "—")
  assert.equal(row.status, "—")
})

void test("an invoice without a due date also reads as a dash", () => {
  assert.equal(projectInvoiceRegisterRow({ ...invoice, dueDate: null }).dueDate, "—")
})

void test("each e-Factura status has a Romanian label", () => {
  const labels = (["not_sent", "queued", "processing", "accepted", "rejected", "refused", "unknown"] as const)
    .map((status) => projectInvoiceRegisterRow({ ...invoice, eFacturaStatus: status }).status)
  assert.deepEqual(labels, ["Netrimisă", "În procesare", "În procesare", "Acceptată", "Respinsă", "Refuzată", "Necunoscut"])
})

void test("a status that needs attention reads in the danger tone; with e-Factura off the dash is muted", () => {
  const classes = (["not_sent", "queued", "processing", "accepted", "rejected", "refused", "unknown"] as const)
    .map((status) => projectInvoiceRegisterRow({ ...invoice, eFacturaStatus: status }).statusClass)
  assert.deepEqual(classes, ["badge muted", "badge info", "badge info", "badge positive",
    "badge text-invoice-danger-text", "badge text-invoice-danger-text", "badge text-invoice-danger-text"])
  assert.equal(projectInvoiceRegisterRow(correction).statusClass, "badge muted")
})

void test("a correction shows its own e-Factura status", () => {
  assert.equal(projectInvoiceRegisterRow({ ...correction, eFacturaStatus: "accepted" }).status, "Acceptată")
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
