import assert from "node:assert/strict"
import test from "node:test"

import { draftIsDeletable } from "./use-drafts.ts"
import { draftDeletionState } from "../lib/invoice-authoring-workflow.ts"
import type { DraftInvoice } from "../lib/draft-models.ts"

const draftOf = (patch: Partial<DraftInvoice> = {}): DraftInvoice => ({
  id: "draft-1", organizationId: "org",
  customer: { partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false,
    address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 } },
  sourceProformaId: null, series: "FCT", issueDate: "2026-01-01", dueDate: null, currency: "RON",
  notes: null, status: "draft", lines: [], vatBreakdown: [],
  totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
  ...patch,
})

void test("the drafts list deletion policy only allows what the workflow allows", () => {
  assert.equal(draftIsDeletable(draftOf()), true)
  assert.equal(draftIsDeletable(draftOf({ sourceProformaId: "prof-1" })), false)
  assert.equal(draftDeletionState(draftOf({ sourceProformaId: "prof-1" })).kind, "derived")
})
