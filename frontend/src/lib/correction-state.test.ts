import assert from "node:assert/strict"
import test from "node:test"

import { correctionInputFrom, correctionSummary, correctionsView } from "./correction-state.ts"
import type { CorrectionDocument, IssuedInvoice } from "./document-snapshot.ts"

const address = { countryCode: "RO", city: "B", street: "s", county: "RO-B" }

const invoice: IssuedInvoice = {
  id: "inv-1", series: "FCT", number: 12, issueDate: "2026-10-01", dueDate: null, notes: null,
  currency: "RON", eFacturaStatus: "not_sent",
  issuer: {
    name: "Beta", fiscalIdentifier: "321", vatRegistered: true, legalForm: "srl",
    tradeRegistryNumber: "J40/1/2020", iban: "RO00XXXX0000000000", bankName: "Banca",
    socialCapital: "100.00", address,
  },
  customer: { partyType: "company", name: "Alfa SRL", fiscalIdentifier: "123", vatRegistered: false, address },
  lines: [], vatBreakdown: [], totalExcludingVat: "100.00", vatTotal: "21.00", totalIncludingVat: "121.00",
}

const correction: CorrectionDocument = {
  ...invoice, id: "cor/1", number: 13, issueDate: "2026-10-09", originalInvoiceId: "inv-1", reason: "Retur integral",
  totalExcludingVat: "-100.00", vatTotal: "-21.00", totalIncludingVat: "-121.00",
}

const form = (entries: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [name, value] of Object.entries(entries)) data.set(name, value)
  return data
}

void test("an invoice without a storno offers the form and is reversed by nothing", () => {
  const view = correctionsView([])
  assert.deepEqual(view, { rows: [], canIssue: true, correctedBy: undefined })
})

void test("a listed storno closes the form, names itself, and reads with its minus sign", () => {
  const view = correctionsView([correction])
  assert.equal(view.canIssue, false)
  assert.deepEqual(view.correctedBy, { id: "cor/1", series: "FCT", number: 13, issueDate: "2026-10-09" })
  assert.deepEqual(view.rows, [{
    id: "cor/1", href: "/corrections/cor%2F1", title: "Storno FCT 13",
    caption: "2026-10-09 · -121.00 RON", reason: "Retur integral",
  }])
})

void test("the request body is trimmed, and a field the form did not carry reads as empty for the backend to refuse", () => {
  assert.deepEqual(correctionInputFrom(form({ reason: "  Retur  ", issueDate: " 2026-10-09 " })), {
    reason: "Retur", issueDate: "2026-10-09",
  })
  assert.deepEqual(correctionInputFrom(form({})), { reason: "", issueDate: "" })
})

void test("the recovery card names the invoice's buyer and series, and the storno's own date", () => {
  assert.deepEqual(correctionSummary(invoice, { reason: "Retur", issueDate: "2026-10-09" }), {
    buyerName: "Alfa SRL", series: "FCT", issueDate: "2026-10-09", lineCount: 0,
  })
})
