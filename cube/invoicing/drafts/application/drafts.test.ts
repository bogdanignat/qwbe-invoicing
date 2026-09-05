import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { contextProvider, each, emptyState, fixedClock, identity, idempotent, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"
import { DomainConflict, ResourceNotFound, ValidationFailure } from "../../contracts/index.ts"

void test("authors snapshot-owned drafts and recalculates every server-derived amount", async () => {
  const state = emptyState()
  const service = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-1" } }), clock: fixedClock,
    ids: sequentialIds(), store: memoryStore(state), cubeIdentity: "invoicing",
  })
  await Effect.runPromise(service.configureIssuer({
    name: "Exemplu SRL", fiscalIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON", defaultPaymentTermDays: 15,
    vatConfigurations: [
      { code: "RO_STANDARD", rate: "19", effectiveFrom: "2020-01-01", effectiveTo: "2025-07-31" },
      { code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" },
    ],
  }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
  const saved = await Effect.runPromise(service.createCustomer({
    partyType: "company", name: "Original SRL", fiscalIdentifier: "RO87654329",
    address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2" },
  }))
  const savedDraft = await Effect.runPromise(service.createDraft({ customerId: saved.id, series: "QWBE", issueDate: "2025-07-31" }))
  assert.equal(savedDraft.customer.name, "Original SRL")
  assert.equal(savedDraft.totalIncludingVat, "0.00")
  state.customers.set(saved.id, { ...saved, name: "Directory Renamed SRL" })
  await Effect.runPromise(service.addDraftLine({ draftId: savedDraft.id, description: "Snapshot", quantity: "1", unitPrice: "100", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }))
  const savedIssued = await Effect.runPromise(service.issueInvoice(idempotent({ draftId: savedDraft.id })))
  assert.equal(savedIssued.customer.name, "Original SRL")
  assert.equal(savedIssued.customer.partyType, "company")

  const inlineBuyer = {
    partyType: "individual" as const, name: "Ion Popescu", fiscalIdentifier: "",
    address: { countryCode: "RO", city: "Cluj-Napoca", street: "Strada Unu 1" },
  }
  const invalidSource = await Effect.runPromise(Effect.flip(service.createDraft({
    customerId: saved.id, customer: inlineBuyer, series: "QWBE", issueDate: "2025-07-31",
  } as never)))
  assert.equal(invalidSource instanceof ValidationFailure, true)
  const draft = await Effect.runPromise(service.createDraft({ customer: inlineBuyer, series: "QWBE", issueDate: "2025-07-31" }))
  assert.equal(draft.customerId, undefined)
  let edited = await Effect.runPromise(service.addDraftLine({
    draftId: draft.id, description: "Consultanță", quantity: "1", unitPrice: "100", unitOfMeasure: each, vatRateCode: "RO_STANDARD",
  }))
  const lineId = edited.lines[0]?.id as string
  assert.equal(edited.totalIncludingVat, "119.00")
  edited = await Effect.runPromise(service.updateDraft({ customer: inlineBuyer, draftId: draft.id, issueDate: "2025-08-01" }))
  assert.equal(edited.lines[0]?.vatRate, "21.00")
  assert.equal(edited.totalIncludingVat, "121.00")
  const unsafeDate = await Effect.runPromise(Effect.flip(service.updateDraft({
    customer: inlineBuyer, draftId: draft.id, issueDate: "2019-12-31",
  })))
  assert.equal(unsafeDate instanceof ValidationFailure, true)
  assert.equal((await Effect.runPromise(service.getDraft(draft.id))).issueDate, "2025-08-01")
  edited = await Effect.runPromise(service.updateDraftLine({
    draftId: draft.id, lineId, description: "Consultanță extinsă", quantity: "2", unitPrice: "100", unitOfMeasure: each, vatRateCode: "RO_STANDARD",
  }))
  assert.equal(edited.totalIncludingVat, "242.00")
  edited = await Effect.runPromise(service.deleteDraftLine(draft.id, lineId))
  assert.equal(edited.totalIncludingVat, "0.00")
  const replacement = await Effect.runPromise(service.addDraftLine({
    draftId: draft.id, description: "Final", quantity: "1", unitPrice: "50", unitOfMeasure: each, vatRateCode: "RO_STANDARD",
  }))
  assert.deepEqual(await Effect.runPromise(service.listDrafts()), [replacement])
  await Effect.runPromise(service.issueInvoice(idempotent({ draftId: draft.id })))
  for (const mutation of [
    service.deleteDraft(draft.id),
    service.deleteDraftLine(draft.id, replacement.lines[0]?.id as string),
    service.updateDraft({ customer: inlineBuyer, draftId: draft.id, issueDate: "2025-08-02" }),
  ]) {
    const failure = await Effect.runPromise(Effect.flip(mutation))
    assert.equal(failure instanceof DomainConflict && failure.code === "invoice_already_issued", true)
  }
  const disposable = await Effect.runPromise(service.createDraft({ customer: inlineBuyer, series: "QWBE", issueDate: "2025-08-02" }))
  await Effect.runPromise(service.deleteDraft(disposable.id))
  assert.equal(await Effect.runPromise(Effect.flip(service.getDraft(disposable.id))) instanceof ResourceNotFound, true)
})
