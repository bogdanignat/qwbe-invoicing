import assert from "node:assert/strict"
import test from "node:test"

import { proformaIssuanceAvailability, proformaStatusLabel, type ProformaIssuanceAvailabilityInput } from "./proforma-state.ts"

const ready: ProformaIssuanceAvailabilityInput = {
  hasSavedDraft: true,
  editable: true,
  synchronized: true,
  hasLines: true,
  workflowPending: false,
  issuancePending: false,
  hasSeries: true,
}

void test("shows issuance for new documents and saved editable drafts", () => {
  assert.deepEqual(proformaIssuanceAvailability(ready), { visible: true, canIssue: true, disabledReason: null })
  assert.equal(proformaIssuanceAvailability({ ...ready, synchronized: false }).visible, true)
  assert.equal(proformaIssuanceAvailability({ ...ready, hasLines: false }).visible, true)
  assert.equal(proformaIssuanceAvailability({ ...ready, editable: false }).visible, false)
  assert.equal(proformaIssuanceAvailability({ ...ready, hasSavedDraft: false }).visible, true)
})

void test("explains each safe issuance gate", () => {
  assert.equal(proformaIssuanceAvailability({ ...ready, synchronized: false }).disabledReason, "Salvează modificările înainte de emiterea proformei.")
  assert.equal(proformaIssuanceAvailability({ ...ready, hasLines: false }).disabledReason, "Completează cel puțin o linie înainte de emitere.")
  assert.equal(proformaIssuanceAvailability({ ...ready, workflowPending: true }).disabledReason, "Așteaptă finalizarea operației în curs.")
  assert.equal(proformaIssuanceAvailability({ ...ready, issuancePending: true }).disabledReason, "Așteaptă finalizarea operației în curs.")
  assert.equal(proformaIssuanceAvailability({ ...ready, hasSeries: false }).disabledReason, "Configurează o serie de proformă înainte de emitere.")
})

void test("distinguishes issued invoices from legacy draft conversions", () => {
  assert.equal(proformaStatusLabel({ convertedDraftId: null, convertedInvoiceId: null }), "Nefacturată")
  assert.equal(proformaStatusLabel({ convertedDraftId: "draft-1", convertedInvoiceId: null }), "Draft factură creat")
  assert.equal(proformaStatusLabel({ convertedDraftId: null, convertedInvoiceId: "invoice-1" }), "Facturată")
})
