import assert from "node:assert/strict"
import test from "node:test"

import { newAuthoringForm } from "./document-authoring-transitions.ts"
import type { Issuer } from "./draft-models.ts"
import { newEditableInvoiceLine } from "./invoice-authoring-model.ts"
import {
  PROFORMA_DUE_DATE_NOTE, proformaSaveReadiness, type ProformaSaveReadinessInput,
} from "./proforma-authoring-readiness.ts"

const issuer = {
  organizationId: "org", name: "Qwbe Software SRL", fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "București", street: "Str. Lungă 1", county: "RO-B", sector: 3 },
  legalForm: "srl", tradeRegistryNumber: "J40/1234/2020", iban: "RO49AAAA1B31007593840000",
  bankName: "Banca Transilvania", socialCapital: "200.00", defaultCurrency: "RON", defaultPaymentTermDays: 14,
  vatConfigurations: [], currentVat: null,
} satisfies Issuer

const filledLine = {
  ...newEditableInvoiceLine("line-1", "RO_STANDARD", { code: "H87", name: "bucată" }),
  description: "Avans", quantity: "2", unitPrice: "500.00",
}

const ready = (): ProformaSaveReadinessInput => ({
  form: { ...newAuthoringForm(issuer, "PRO", false, "2026-02-01"), name: "Alfa SRL" },
  lines: [filledLine],
  seriesOptions: ["PRO"],
  pending: false,
  blocked: false,
})

void test("a complete proforma with a chosen series may be saved", () => {
  const readiness = proformaSaveReadiness(ready())

  assert.equal(readiness.canSave, true)
  assert.equal(readiness.notesIssue, null)
  assert.equal(readiness.seriesMissing, false)
  // The default form derives a due date from the issuer's payment terms.
  assert.equal(readiness.dueDateNote, null)
})

void test("the save is closed without a series, on an empty line, while pending, or while blocked", () => {
  const base = ready()

  assert.equal(proformaSaveReadiness({ ...base, form: { ...base.form, series: "" } }).canSave, false)
  // A series the catalogue no longer offers counts as none chosen.
  assert.equal(proformaSaveReadiness({ ...base, seriesOptions: ["ALT"] }).canSave, false)
  assert.equal(proformaSaveReadiness({ ...base, lines: [] }).canSave, false)
  assert.equal(proformaSaveReadiness({ ...base, lines: [{ ...filledLine, unitPrice: "" }] }).canSave, false)
  assert.equal(proformaSaveReadiness({ ...base, pending: true }).canSave, false)
  assert.equal(proformaSaveReadiness({ ...base, blocked: true }).canSave, false)
})

void test("notes beyond the server's limit close the save and say why", () => {
  const base = ready()
  const readiness = proformaSaveReadiness({ ...base, form: { ...base.form, notes: "x".repeat(301) } })

  assert.equal(readiness.canSave, false)
  assert.match(readiness.notesIssue ?? "", /300/)
})

/**
 * A due date is optional on a proforma, but its absence decides what the
 * document can become: the conversion to an issued invoice needs the term, so
 * the note is shown while the field can still be filled.
 */
void test("a positive proforma without a due date is saveable, with a note about what it limits", () => {
  const base = ready()
  const readiness = proformaSaveReadiness({ ...base, form: { ...base.form, dueDate: "" } })

  assert.equal(readiness.canSave, true)
  assert.equal(readiness.dueDateNote, PROFORMA_DUE_DATE_NOTE)
})

void test("a zero-total proforma without a due date gets no note: nothing will be owed", () => {
  const base = ready()
  const readiness = proformaSaveReadiness({
    ...base, form: { ...base.form, dueDate: "" }, lines: [{ ...filledLine, unitPrice: "0" }],
  })

  assert.equal(readiness.dueDateNote, null)
})

void test("an empty catalogue is reported as a missing series, not as a failure", () => {
  const base = ready()
  const readiness = proformaSaveReadiness({ ...base, seriesOptions: [], form: { ...base.form, series: "" } })

  assert.equal(readiness.seriesMissing, true)
  assert.equal(readiness.canSave, false)
})
