import assert from "node:assert/strict"
import test from "node:test"

import { applyProductPreset, choosePresetForLine, draftLinesForEditing, lineInputMatches } from "./document-authoring-options.ts"
import { newEditableDocumentLine } from "./document-authoring-form-model.ts"
import { decodeItemIdentifiers } from "./document-snapshot-decoders.ts"
import { authoringPayloadMatchesDraft, authoringDocumentPayload, draftLinePayload } from "./invoice-authoring-payload.ts"
import { pendingLineOperations } from "./invoice-authoring-readiness.ts"
import { documentLinesReady } from "./document-authoring-readiness.ts"
import { barcodeIssue, isGtin, itemCodeIssue } from "./item-identifiers.ts"
import { decodeProductPreset } from "./registry-decoders.ts"
import { formFromDraft } from "./document-authoring-transitions.ts"
import type { DraftInvoice, ProductPreset } from "./draft-models.ts"

const unit = { code: "C62", name: "unitate" }
const screw: ProductPreset = {
  id: "prs-1", organizationId: "org", code: "SRB-M6", kind: "goods", description: "Șurub M6", unitPrice: "1.50",
  unitOfMeasure: unit, barcode: "00012345600012",
}
const labour: ProductPreset = { id: "prs-2", organizationId: "org", code: "MAN", kind: "service", description: "Manoperă",
  unitPrice: "100.00", unitOfMeasure: unit }
const blank = newEditableDocumentLine("line-a", "RO_STANDARD", unit)
const saved = { id: "line-1", description: "Șurub M6", quantity: "1", unitPrice: "1.50", unitOfMeasure: unit,
  vatRateCode: "RO_STANDARD", vatRate: "21.00", vatCategoryCode: "S" as const, vatExemptionReason: null,
  totalExcludingVat: "1.50", vatAmount: "0.32", totalIncludingVat: "1.82", itemCode: "SRB-M6", barcode: "00012345600012" }
const draft: DraftInvoice = {
  id: "draft-1", organizationId: "org",
  customer: { partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false,
    address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 } },
  sourceProformaId: null, series: "FCT", issueDate: "2026-01-01", dueDate: null, currency: "RON",
  notes: null, status: "draft", lines: [saved],
  vatBreakdown: [], totalExcludingVat: "1.50", vatTotal: "0.32", totalIncludingVat: "1.82",
}

void test("choosing a product copies its code and EAN; choosing one without an EAN drops the earlier EAN", () => {
  const first = applyProductPreset(blank, screw, "RO_STANDARD")
  assert.deepEqual([first.itemCode, first.barcode], ["SRB-M6", "00012345600012"])
  const [again] = choosePresetForLine([{ ...first, lineId: "line-1" }], "line-a", labour, "RO_REDUCED")
  assert.deepEqual(again, { key: "line-a", lineId: "line-1", description: "Manoperă", quantity: "1", unitPrice: "100.00",
    unitOfMeasure: unit, vatRateCode: "RO_REDUCED", itemCode: "MAN" })
})

void test("a line sends its identifiers trimmed and omits a cleared one; a line typed by hand sends none", () => {
  const typed = { ...blank, description: "Ceva", unitPrice: "1", itemCode: " SRB-M6 ", barcode: "" }
  assert.deepEqual(draftLinePayload(typed), { description: "Ceva", quantity: "1", unitPrice: "1", unitOfMeasure: unit,
    vatRateCode: "RO_STANDARD", itemCode: "SRB-M6" })
  assert.equal(Object.hasOwn(draftLinePayload(blank), "itemCode") || Object.hasOwn(draftLinePayload(blank), "barcode"), false)
})

void test("a saved line comes back with its identifiers, and a change of the code alone is a change to save", () => {
  const [editable] = draftLinesForEditing(draft)
  assert.ok(editable !== undefined)
  assert.deepEqual([editable.itemCode, editable.barcode], ["SRB-M6", "00012345600012"])
  assert.deepEqual(pendingLineOperations([editable], draft), [])
  assert.equal(lineInputMatches({ ...editable, itemCode: " SRB-M6 " }, saved), true)
  for (const change of [{ itemCode: "SRB-M8" }, { itemCode: "" }, { barcode: "96385074" }]) {
    assert.equal(lineInputMatches({ ...editable, ...change }, saved), false, JSON.stringify(change))
    assert.equal(pendingLineOperations([{ ...editable, ...change }], draft)[0]?.kind, "update", JSON.stringify(change))
  }
})

void test("the issuance check refuses a draft whose line identifiers differ from the session's", () => {
  const [editable] = draftLinesForEditing(draft)
  assert.ok(editable !== undefined)
  const form = formFromDraft(draft)
  assert.equal(authoringPayloadMatchesDraft(authoringDocumentPayload(form, [editable]), draft), true)
  assert.equal(authoringPayloadMatchesDraft(authoringDocumentPayload(form, [{ ...editable, barcode: "" }]), draft), false)
})

void test("the decoders keep a present identifier as text and an absent one absent", () => {
  assert.deepEqual(decodeItemIdentifiers({ itemCode: "SRB-M6", barcode: "00012345600012" }), { itemCode: "SRB-M6", barcode: "00012345600012" })
  assert.deepEqual(decodeItemIdentifiers({}), {})
  assert.deepEqual(decodeProductPreset({ ...labour }), labour)
  assert.deepEqual(decodeProductPreset({ ...screw }), screw)
  assert.throws(() => decodeProductPreset({ ...labour, kind: "other" }))
  assert.throws(() => decodeProductPreset({ ...labour, code: undefined }))
})

void test("a GTIN is 8, 12, 13 or 14 digits whose last one checks", () => {
  for (const value of ["96385074", "036000291452", "4006381333931", "00012345600012", "10614141000415"]) assert.equal(isGtin(value), true, value)
  for (const value of ["96385075", "4006381333932", "12345678901", "123456789012345", "400638133393a", ""]) assert.equal(isGtin(value), false, value)
})

void test("a wrong EAN on a line is refused here, in Romanian, before any payload is built", () => {
  const ean = "EAN-ul are 8, 12, 13 sau 14 cifre, cu cifra de control corectă."
  assert.deepEqual(["", "  ", " 00012345600012 "].map(barcodeIssue), [null, null, null])
  assert.deepEqual(["4006381333932", "123", "abc"].map(barcodeIssue), [ean, ean, ean])
  const filled = { ...blank, description: "Șurub", unitPrice: "1.50" }
  assert.equal(documentLinesReady([filled]), true)
  assert.equal(documentLinesReady([{ ...filled, barcode: "00012345600012" }]), true)
  assert.equal(documentLinesReady([{ ...filled, barcode: "" }]), true)
  assert.equal(documentLinesReady([{ ...filled, barcode: "4006381333932" }]), false)
})

void test("an article code on a line or a product is printable ASCII, refused here in Romanian otherwise", () => {
  const signs = "Codul poate conține doar litere fără diacritice, cifre și semne obișnuite."
  assert.deepEqual(["", "  ", " SRB-M6 ", "SRB/M6 #1 (v2.0)", "x".repeat(50)].map(itemCodeIssue), [null, null, null, null, null])
  assert.deepEqual(["ȘURUB", "café", "A\tB", `A${String.fromCodePoint(0xa0)}B`, "😀"].map(itemCodeIssue), [signs, signs, signs, signs, signs])
  assert.equal(itemCodeIssue("x".repeat(51)), "Codul articolului are cel mult 50 de caractere.")
  const filled = { ...blank, description: "Șurub", unitPrice: "1.50" }
  assert.equal(documentLinesReady([{ ...filled, itemCode: "SRB-M6" }]), true)
  assert.equal(documentLinesReady([{ ...filled, itemCode: "ȘURUB" }]), false)
})
