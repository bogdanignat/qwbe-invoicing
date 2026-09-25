import assert from "node:assert/strict"
import test from "node:test"

import { documentLinesReady, documentTaxReadiness, STALE_TAX_WARNING } from "./document-authoring-readiness.ts"
import { newEditableDocumentLine } from "./document-authoring-form-model.ts"

/**
 * The two rules every document shares before it may be issued, checked here on
 * their own so a proforma screen inherits them instead of restating them.
 */

const unit = { code: "C62", name: "unitate" }

const filled = { ...newEditableDocumentLine("k1", "RO_STANDARD", unit), description: "Consultanță", unitPrice: "100.00" }

void test("a document with no lines is not ready, whatever else is filled", () => {
  assert.equal(documentLinesReady([]), false)
})

void test("a line is only a line when every field it needs is filled", () => {
  assert.equal(documentLinesReady([filled]), true)
  assert.equal(documentLinesReady([{ ...filled, description: "   " }]), false)
  assert.equal(documentLinesReady([{ ...filled, unitPrice: "" }]), false)
  assert.equal(documentLinesReady([{ ...filled, quantity: " " }]), false)
  assert.equal(documentLinesReady([{ ...filled, vatRateCode: "" }]), false)
  assert.equal(documentLinesReady([{ ...filled, unitOfMeasure: { code: "", name: "unitate" } }]), false)
  // One bad line is enough: the document is issued whole.
  assert.equal(documentLinesReady([filled, { ...filled, key: "k2", description: "" }]), false)
})

void test("a VAT configuration that changed under the lines withdraws the right to issue", () => {
  const ready = { canIssue: true, synchronized: true }
  assert.deepEqual(documentTaxReadiness(ready, false), { canIssue: true, synchronized: true, warning: null })
  assert.deepEqual(documentTaxReadiness(ready, true), {
    canIssue: false, synchronized: false, warning: STALE_TAX_WARNING,
  })
})

void test("a stale configuration never turns a blocked document into an issuable one", () => {
  assert.equal(documentTaxReadiness({ canIssue: false, synchronized: false }, false).canIssue, false)
})
