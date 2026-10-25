import assert from "node:assert/strict"
import test from "node:test"

import { decodeReceivedDetail, decodeReceivedPage, decodeReceivedStatus } from "./received-decoders.ts"
import { projectReceivedDocument } from "./received-detail-projection.ts"

const eur = (value: string) => ({ value, currency: "EUR" })
const listing = {
  kind: "invoice", number: "EU-7", issueDate: "2026-10-20", currency: "EUR", supplierName: "Furnizor UE SRL",
  supplierCif: "RO19999927", totalExcludingTax: "1234.50", taxTotal: "259.25", payable: "1493.75",
}
/** An answer of `GET /api/efactura/received/{id}`: an invoice in EUR whose VAT the XML also gives in RON. */
const answer = {
  messageId: "4000000009", spvCreatedAt: "202610201530", storedAt: "2026-10-20T13:31:00.000Z", readable: true, listing,
  warnings: [{ code: "tax_inclusive_mismatch", declared: "1493.75", computed: "1493.76" }],
  content: {
    kind: "invoice", number: "EU-7", issueDate: "2026-10-20", dueDate: "2026-11-19", currency: "EUR", taxCurrency: "RON",
    notes: ["Plata în 30 de zile"], paymentAccounts: ["RO49AAAA1B31007593840000"], billingReferences: [], contractReferences: [],
    allowanceCharges: [],
    supplier: { name: "Furnizor UE SRL", vatId: "RO19999927", registrationId: "J40/1/2020",
      address: { street: "Str. Exemplu 1", city: "București", county: "RO-B", country: "RO" } },
    buyer: { name: "Firma Noastră SRL", taxRegistrationId: "12345674" },
    totals: { lineExtension: eur("1234.50"), taxExclusive: eur("1234.50"), taxInclusive: eur("1493.75"), payable: eur("1493.75") },
    vat: { total: eur("259.25"), taxCurrencyTotal: { value: "1290.12", currency: "RON" },
      breakdown: [{ category: "S", percent: "21.00", taxable: eur("1234.50"), tax: eur("259.25") }] },
    lines: [{ id: "1", name: "Servicii", quantity: { value: "1.333", unit: "HUR" }, priceBaseQuantity: { value: "1", unit: "HUR" },
      unitPrice: eur("926.1255"), netAmount: eur("1234.50"), vatCategory: "S", vatPercent: "21", allowanceCharges: [], classifications: [] }],
  },
}

const decoded = decodeReceivedDetail(answer)
assert.ok(decoded.readable)
const view = projectReceivedDocument(decoded)

void test("the head names the document, its dates, its currency and its SPV message", () => {
  assert.equal(view.heading, "Factură EU-7")
  assert.deepEqual(view.facts.map((fact) => [fact.label, fact.value]), [
    ["Data emiterii", "2026-10-20"], ["Scadență", "2026-11-19"], ["Monedă", "EUR"], ["Primită în SPV", "20.10.2026 15:30"],
    ["Mesaj SPV", "4000000009"],
  ])
})

void test("a line keeps the quantity and the unit price exactly as the XML wrote them", () => {
  assert.deepEqual(view.lines, [{
    key: "0:1", description: "Servicii", quantity: "1.333 HUR", unitPrice: "926.1255 EUR / 1 HUR", vat: "S 21%", net: "1,234.50 EUR",
  }])
})

void test("an invoice in EUR shows its VAT in RON as the document gives it, beside the VAT by rate", () => {
  assert.deepEqual(view.totals.map((total) => [total.label, total.value]), [
    ["Total linii", "1,234.50 EUR"], ["Total fără TVA", "1,234.50 EUR"], ["TVA", "259.25 EUR"], ["TVA în RON", "1,290.12 RON"],
    ["Total cu TVA", "1,493.75 EUR"], ["De plată", "1,493.75 EUR"],
  ])
  assert.deepEqual(view.vatRows, [{ key: "0:S:21.00", rate: "S 21%", base: "1,234.50 EUR", amount: "259.25 EUR", note: "—" }])
})

void test("the parties carry their identifiers, address and the accounts to pay into", () => {
  assert.deepEqual(view.parties, [
    { heading: "Furnizor", name: "Furnizor UE SRL",
      details: ["Cod TVA: RO19999927", "Nr. înregistrare: J40/1/2020", "Str. Exemplu 1, București, RO-B, RO", "IBAN: RO49AAAA1B31007593840000"] },
    { heading: "Cumpărător", name: "Firma Noastră SRL", details: ["CIF: 12345674"] },
  ])
  assert.deepEqual(view.notes, ["Plata în 30 de zile"])
})

void test("each warning of the document is a sentence with what was declared and what adds up", () => {
  assert.deepEqual(view.warnings, [
    "Totaluri inconsecvente: totalul fără TVA plus TVA dă 1493.76, iar totalul cu TVA declarat este 1493.75.",
  ])
})

void test("an unreadable answer decodes to its reason; a shape the API never sends is refused at the boundary", () => {
  const unread = decodeReceivedDetail({ ...answer, readable: false, reason: { source: "ubl", failure: { reason: "missing", field: "cbc:ID" } } })
  assert.deepEqual([unread.readable, unread.readable ? undefined : unread.reason], [false, { source: "ubl", failure: { reason: "missing", field: "cbc:ID" } }])
  assert.throws(() => decodeReceivedDetail({ ...answer, readable: "yes" }), /invalid readable/u)
  assert.throws(() => decodeReceivedPage({ items: [{ ...answer, warnings: ["other"] }], nextCursor: null }), /invalid warning/u)
})

void test("the list page and the status decode as the API sends them", () => {
  const page = decodeReceivedPage({ items: [{ ...answer, content: undefined, warnings: ["buyer_cif_mismatch"] }], nextCursor: "c1" })
  assert.deepEqual([page.nextCursor, page.items[0]?.readable === true ? page.items[0].dueDate : "?"], ["c1", undefined])
  const status = decodeReceivedStatus({ coveredUntil: null, fetch: {
    id: "f", environment: "test", cif: "12345674", window: { start: "a", end: "b" }, state: "listing", pagesListed: 0, pagesTotal: 0,
    found: 0, queued: 0, downloaded: 0, failed: 0, errors: [], createdBy: "owner", createdAt: "a", updatedAt: "a",
  } })
  assert.deepEqual([status.fetch?.state, status.fetch?.window.gap, status.coveredUntil], ["listing", undefined, null])
})
