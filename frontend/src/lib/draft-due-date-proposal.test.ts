import assert from "node:assert/strict"
import test from "node:test"

import {
  editDueDate, formFromDraft, proposeMissingDueDate, selectIssueDate, selectSavedCustomer, selectedSavedCustomer,
} from "./document-authoring-transitions.ts"
import { headerMatchesDraft } from "./invoice-authoring-readiness.ts"
import { draftBuyerToRead, openingAuthoringForm } from "./invoice-authoring-opening.ts"
import type { Customer, DraftInvoice, Issuer } from "./draft-models.ts"

const buyer = {
  partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false,
  address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 },
} as const

const issuer = { defaultPaymentTermDays: 14 } as Issuer
const alfa: Customer = { ...buyer, id: "client-1", organizationId: "org", defaultPaymentTermDays: 30 }
const beta: Customer = { ...buyer, id: "client-2", organizationId: "org", name: "Beta" }

const oneTimeDraft = (patch: Partial<DraftInvoice> = {}): DraftInvoice => ({
  id: "draft-1", organizationId: "org", customer: buyer,
  sourceProformaId: null, series: "FCT", issueDate: "2026-01-10", dueDate: null, currency: "RON",
  notes: null, status: "draft", lines: [],
  vatBreakdown: [], totalExcludingVat: "100.00", vatTotal: "0.00", totalIncludingVat: "100.00",
  ...patch,
})

const draftOf = (patch: Partial<DraftInvoice> = {}): DraftInvoice => oneTimeDraft({ customerId: "client-1", ...patch })

const openedWith = (draft: DraftInvoice, savedBuyer: Customer | undefined) =>
  proposeMissingDueDate(formFromDraft(draft), draft, savedBuyer, issuer)
const opened = (draft: DraftInvoice) => openedWith(draft, alfa)

void test("an open draft without a due date gets the saved buyer's payment term", () => {
  const draft = draftOf()
  const form = opened(draft)
  assert.equal(form.dueDate, "2026-02-09")
  assert.equal(form.dueDateEdited, false)
  // The proposal is an unsaved header change: the existing save sends it.
  assert.equal(headerMatchesDraft(form, draft), false)
  assert.equal(headerMatchesDraft(form, { ...draft, dueDate: "2026-02-09" }), true)
})

void test("the issuer's term applies to a one-time buyer and to a buyer without its own term", () => {
  assert.equal(opened(oneTimeDraft()).dueDate, "2026-01-24")
  assert.equal(openedWith(draftOf({ customerId: "client-2" }), beta).dueDate, "2026-01-24")
  // A buyer that could not be read falls back to the issuer's term, and so does one read for another draft.
  assert.equal(openedWith(draftOf(), undefined).dueDate, "2026-01-24")
  assert.equal(openedWith(draftOf({ customerId: "client-2" }), alfa).dueDate, "2026-01-24")
})

void test("a draft that has a due date, or is no longer open, keeps what it has", () => {
  const dated = draftOf({ dueDate: "2026-03-01" })
  assert.deepEqual(opened(dated), formFromDraft(dated))
  assert.equal(opened(dated).dueDateEdited, true)
  const issued = draftOf({ status: "issued" })
  assert.deepEqual(opened(issued), formFromDraft(issued))
  assert.equal(opened(issued).dueDate, "")
})

void test("the proposal follows the issue date and the buyer until the user types a due date", () => {
  const form = opened(draftOf())
  const moved = selectIssueDate(form, "2026-01-20", selectedSavedCustomer(form, [alfa]), issuer, true)
  assert.equal(moved.dueDate, "2026-02-19")
  const otherBuyer = selectSavedCustomer(moved, "client-2", beta, issuer, true)
  assert.equal(otherBuyer.dueDate, "2026-02-03")
  const typed = editDueDate(otherBuyer, "2026-04-01")
  assert.equal(selectIssueDate(typed, "2026-01-25", beta, issuer, true).dueDate, "2026-04-01")
})

void test("the authoring screen opens a draft without a due date on the proposal, and a new document as before", () => {
  const opening = {
    issuer, vatCatalogue: { rates: [] }, customers: [alfa], invoiceSeries: ["FCT"], unitOfMeasures: [],
  }
  // The buyer read by id gives its own term even when the loaded registry page does not hold it.
  const draftForm = openingAuthoringForm({ ...opening, customers: [], initialDraft: draftOf(), draftBuyer: alfa }, "2026-05-01")
  assert.equal(draftForm.dueDate, "2026-02-09")
  assert.equal(draftForm.issueDate, "2026-01-10")
  const fresh = openingAuthoringForm({ ...opening, initialDraft: undefined, draftBuyer: undefined }, "2026-05-01")
  assert.equal(fresh.dueDate, "2026-05-15")
  assert.equal(fresh.dueDateEdited, false)
})

void test("the saved buyer is read only for an open draft without a due date", () => {
  assert.equal(draftBuyerToRead(draftOf()), "client-1")
  assert.equal(draftBuyerToRead(draftOf({ dueDate: "2026-03-01" })), undefined)
  assert.equal(draftBuyerToRead(draftOf({ status: "issued" })), undefined)
  assert.equal(draftBuyerToRead(oneTimeDraft()), undefined)
  assert.equal(draftBuyerToRead(undefined), undefined)
})
