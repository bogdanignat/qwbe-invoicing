import assert from "node:assert/strict"
import test from "node:test"

import {
  projectProforma, projectProformaRegister, projectProformaRegisterRow, proformaDetailHref, proformaStatus,
} from "./proforma-projection.ts"
import type { Proforma } from "./proforma-models.ts"

const proforma: Proforma = {
  id: "prf-1",
  series: "PRO",
  number: 7,
  issueDate: "2026-02-01",
  dueDate: "2026-02-15",
  currency: "RON",
  notes: "Plata în 14 zile",
  sourceDraftId: null,
  convertedInvoiceId: null,
  convertedDraftId: null,
  issuer: {
    name: "Qwbe Software SRL",
    fiscalIdentifier: "12345674",
    address: { countryCode: "RO", city: "București", street: "Str. Lungă 1", county: "RO-B", sector: 3 },
    legalForm: "srl",
    tradeRegistryNumber: "J40/1234/2020",
    iban: "RO49AAAA1B31007593840000",
    bankName: "Banca Transilvania",
    socialCapital: "200.00",
    vatRegistered: true,
  },
  customer: {
    name: "Alfa SRL",
    fiscalIdentifier: "87654329",
    address: { countryCode: "RO", city: "Cluj-Napoca", street: "Str. Scurtă 2", county: "RO-CJ" },
    partyType: "company",
    vatRegistered: true,
  },
  lines: [{
    id: "line-1",
    description: "Avans",
    quantity: "2",
    unitPrice: "500.00",
    unitOfMeasure: { code: "H87", name: "bucată" },
    vatRateCode: "RO_STANDARD",
    vatRate: "21.00",
    vatCategoryCode: "S",
    vatExemptionReason: null,
    totalExcludingVat: "1000.00",
    vatAmount: "210.00",
    totalIncludingVat: "1210.00",
  }],
  vatBreakdown: [{
    code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null,
    vatBaseAmount: "1000.00", vatAmount: "210.00",
  }],
  totalExcludingVat: "1000.00",
  vatTotal: "210.00",
  totalIncludingVat: "1210.00",
}

void test("the status is derived from the two conversion ids and nothing else", () => {
  assert.deepEqual(proformaStatus(proforma), { label: "Nefacturată", tone: "muted" })
  assert.deepEqual(
    proformaStatus({ ...proforma, convertedDraftId: "draft-2" }),
    { label: "Draft factură creat", tone: "info" },
  )
  assert.deepEqual(
    proformaStatus({ ...proforma, convertedInvoiceId: "inv-2" }),
    { label: "Facturată", tone: "positive" },
  )
})

/**
 * A draft created from a proforma can later be issued, and the server then holds
 * both ids. "Facturată" is the stronger, later fact, so it must win — reading
 * "Draft factură creat" would invite a second conversion the server refuses.
 */
void test("a proforma whose draft has become an invoice reads as invoiced", () => {
  assert.deepEqual(
    proformaStatus({ ...proforma, convertedDraftId: "draft-2", convertedInvoiceId: "inv-2" }),
    { label: "Facturată", tone: "positive" },
  )
})

void test("a registry row is shaped for the table, dashes and links included", () => {
  const row = projectProformaRegisterRow(proforma)

  assert.equal(row.key, "prf-1")
  assert.equal(row.number, "PRO 7")
  assert.equal(row.documentHref, "/proformas/prf-1")
  assert.equal(row.customerName, "Alfa SRL")
  assert.equal(row.issueDate, "2026-02-01")
  assert.equal(row.dueDate, "2026-02-15")
  assert.equal(row.total, "1210.00 RON")
  assert.deepEqual(row.status, { label: "Nefacturată", tone: "muted" })
  assert.equal(projectProformaRegisterRow({ ...proforma, dueDate: null }).dueDate, "—")
})

void test("an identifier that needs escaping is escaped once, in the href", () => {
  assert.equal(proformaDetailHref("prf/1 2"), "/proformas/prf%2F1%202")
  assert.equal(projectProformaRegisterRow({ ...proforma, id: "prf/1" }).documentHref, "/proformas/prf%2F1")
})

void test("a register projects every row and keeps their order", () => {
  const rows = projectProformaRegister([proforma, { ...proforma, id: "prf-2", number: 8 }])

  assert.deepEqual(rows.map((row) => row.number), ["PRO 7", "PRO 8"])
})

void test("the document is projected through the shared body with a head of its own", () => {
  const view = projectProforma(proforma)

  assert.equal(view.heading, "PRO 7")
  assert.deepEqual(view.facts, [
    { label: "Emisă", value: "2026-02-01" },
    { label: "Scadență", value: "2026-02-15" },
    { label: "Monedă", value: "RON" },
    { label: "Status", value: "Nefacturată" },
  ])
  assert.deepEqual(view.parties.map((party) => party.heading), ["Furnizor", "Cumpărător"])
  assert.equal(view.lines.length, 1)
  assert.equal(view.lines[0]?.vat, "TVA 21.00%")
  assert.equal(view.vatRows.length, 1)
  assert.deepEqual(view.totals.map((total) => total.value), ["1000.00 RON", "210.00 RON", "1210.00 RON"])
  assert.equal(view.notes, "Plata în 14 zile")
  // A proforma has no fiscal predecessor; its conversion links live in their own section.
  assert.equal(view.originalInvoice, null)
})

void test("the document head reports the conversion, never an e-Factura status", () => {
  const view = projectProforma({ ...proforma, convertedInvoiceId: "inv-2", notes: null })

  assert.deepEqual(view.facts.at(-1), { label: "Status", value: "Facturată" })
  assert.equal(view.facts.some((fact) => fact.label === "e-Factura"), false)
  assert.equal(view.notes, null)
})
