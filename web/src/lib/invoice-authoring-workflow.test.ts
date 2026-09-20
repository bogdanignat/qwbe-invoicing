import assert from "node:assert/strict"
import test from "node:test"
import {
  authoringBackgroundErrors, draftDeletionState, invoiceDueDateIssue,
} from "./invoice-authoring-workflow.ts"
import type { DraftInvoice } from "./models.ts"

const draft = (sourceProformaId: string | null): DraftInvoice => ({
  id: "draft-1", organizationId: "org-1", customerId: "customer-1", sourceProformaId,
  customer: { partyType: "company", name: "Client", fiscalIdentifier: "1", vatRegistered: false, address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" } },
  series: "QWBE", issueDate: "2026-09-20", dueDate: null, currency: "RON", notes: null, status: "draft",
  lines: [], vatBreakdown: [], totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
})

void test("keeps deletion ownership tied to draft provenance", () => {
  assert.deepEqual(draftDeletionState(undefined), { kind: "hidden" })
  assert.deepEqual(draftDeletionState(draft(null)), { kind: "available" })
  assert.deepEqual(draftDeletionState(draft("proforma/1")), { kind: "derived", sourceHref: "/proformas/proforma%2F1" })
})

void test("describes a missing required invoice due date", () => {
  assert.equal(invoiceDueDateIssue(false), null)
  assert.equal(
    invoiceDueDateIssue(true),
    "Data scadenței este obligatorie pentru o factură cu total pozitiv.",
  )
})

void test("appends an authoring background error without reordering existing errors", () => {
  const existing = [new Error("customers"), new Error("issuer")]
  assert.equal(authoringBackgroundErrors(existing, null), existing)
  const additional = new Error("presets")
  assert.deepEqual(authoringBackgroundErrors(existing, additional), [...existing, additional])
})
