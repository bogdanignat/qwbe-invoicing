import assert from "node:assert/strict"
import test from "node:test"

import type { ReceivedListing, ReceivedSummary, UnreadableReason } from "./received-models.ts"
import { projectReceivedRow, spvDate, unreadableText } from "./received-projection.ts"

const listing: ReceivedListing = {
  kind: "invoice", number: "TEST 19", issueDate: "2026-10-23", currency: "EUR", supplierName: "FURNIZOR TEST S.R.L.",
  supplierCif: "RO19999927", totalExcludingTax: "1000.00", taxTotal: "210.00", payable: "1210.00",
}
const message = { messageId: "4000000001", spvCreatedAt: "202610221000", storedAt: "2026-10-22T08:00:00.000Z" }
const read = (overrides: Partial<Extract<ReceivedSummary, { readable: true }>> = {}): ReceivedSummary =>
  ({ ...message, readable: true, listing, dueDate: "2026-11-06", warnings: [], ...overrides })

void test("a read invoice is a row of its columns, totals grouped but not rounded, in its own currency", () => {
  const row = projectReceivedRow(read())
  assert.deepEqual(row, {
    key: "4000000001", href: "/received/4000000001", label: "TEST 19", linkName: "Factură TEST 19 de la FURNIZOR TEST S.R.L.",
    kindLabel: null, supplierName: "FURNIZOR TEST S.R.L.", supplierCif: "RO19999927", issueDate: "2026-10-23", dueDate: "2026-11-06",
    total: "1,210.00", vat: "210.00", currency: "EUR", readable: true, readLabel: "Citită", notes: [],
  })
})

void test("a credit note is marked, a missing due date is a dash, and warnings become one label per kind", () => {
  const row = projectReceivedRow(read({
    listing: { ...listing, kind: "credit_note" }, dueDate: undefined,
    warnings: ["lines_total_mismatch", "tax_inclusive_mismatch", "buyer_cif_mismatch"],
  }))
  assert.deepEqual([row.kindLabel, row.dueDate, row.linkName], ["Notă de credit", "—", "Notă de credit TEST 19 de la FURNIZOR TEST S.R.L."])
  assert.deepEqual(row.notes, ["Totaluri inconsecvente", "Cumpărătorul are alt CIF"])
})

void test("an unreadable one is named by its SPV message, unread, with why", () => {
  const row = projectReceivedRow({ ...message, readable: false, reason: { source: "zip", refusal: "bad_signature" } })
  assert.deepEqual([row.label, row.linkName, row.readable, row.readLabel, row.supplierName, row.total, row.href],
    ["Mesaj SPV 4000000001", "Mesaj SPV 4000000001, necitit", false, "Necitită", "—", "—", "/received/4000000001"])
  assert.deepEqual(row.notes, ["Arhiva ZIP nu a putut fi deschisă (bad_signature)."])
})

void test("every reason an archive is unreadable has its sentence; codes and paths stay as the server wrote them", () => {
  const cases: ReadonlyArray<readonly [UnreadableReason, string]> = [
    [{ source: "encoding" }, "XML-ul facturii nu este text UTF-8 valid."],
    [{ source: "ubl", failure: { reason: "xml", refusal: "doctype" } }, "XML-ul facturii nu a putut fi citit (doctype)."],
    [{ source: "ubl", failure: { reason: "not_ubl" } }, "Documentul din arhivă nu este o factură sau o notă de credit UBL."],
    [{ source: "ubl", failure: { reason: "missing", field: "cbc:ID" } }, "În XML lipsește câmpul cbc:ID."],
    [{ source: "ubl", failure: { reason: "duplicate", field: "cbc:IssueDate" } }, "În XML apare de mai multe ori câmpul cbc:IssueDate."],
    [{ source: "ubl", failure: { reason: "invalid", field: "cbc:PayableAmount" } }, "În XML are o valoare invalidă câmpul cbc:PayableAmount."],
    [{ source: "ubl", failure: { reason: "unbound_prefix", field: "x:Foo" } }, "În XML are un prefix XML nedeclarat câmpul x:Foo."],
  ]
  for (const [reason, text] of cases) assert.equal(unreadableText(reason), text)
})

void test("ANAF's data_creare reads as a Romanian date and time; anything else stays as it came", () => {
  assert.equal(spvDate("202610221000"), "22.10.2026 10:00")
  assert.equal(spvDate("2026-10-22"), "2026-10-22")
})
