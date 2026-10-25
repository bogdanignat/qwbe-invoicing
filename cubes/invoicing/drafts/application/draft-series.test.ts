import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import {
  brandingNormalizer, contextProvider, each, emptyState, expectConflict, fixedClock, identity, idempotent, memoryStore, sequentialIds,
} from "../../application/memory-store.test-support.ts"
import { ResourceNotFound, ValidationFailure } from "../../contracts/index.ts"

/** T-2082: an open draft is never stuck on an archived series; it moves to an active one, or is deleted. */

const customer = {
  partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
  address: { countryCode: "RO", city: "Iași", street: "Strada 2", county: "RO-IS" },
}
const line = { description: "Servicii", quantity: "1", unitPrice: "10", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }
const header = { customer, issueDate: "2026-09-01", dueDate: "2026-09-15" }
const run = Effect.runPromise
const flip = <Value, Failure>(effect: Effect.Effect<Value, Failure>) => Effect.runPromise(Effect.flip(effect))

const configured = async () => {
  const state = emptyState()
  const service = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), branding: brandingNormalizer, cubeIdentity: "invoicing",
  })
  await run(service.configureIssuer({
    name: "Exemplu SRL", fiscalIdentifier: "12345674", address: { countryCode: "RO", city: "Botoșani", street: "Strada 1", county: "RO-BT" },
    legalForm: "srl", tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca", socialCapital: "1000.00",
    defaultCurrency: "RON", defaultPaymentTermDays: 15, vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null,
  }))
  for (const series of ["OLD", "NEW", "SPARE"]) await run(service.addDocumentSeries({ documentType: "invoice", series }))
  await run(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
  const draft = await run(service.createDraft(idempotent({ ...header, series: "OLD", lines: [line] })))
  await run(service.setDocumentSeriesArchived({ documentType: "invoice", series: "OLD", archived: true }))
  return { service, state, draft }
}

void test("a draft on an archived series stays editable but is issued only once moved to an active series", async () => {
  const { service, state, draft } = await configured()
  // No series in the update keeps the one the draft has, archived or not; the same one again is no move.
  assert.equal((await run(service.updateDraft({ draftId: draft.id, ...header, notes: "Nota" }))).series, "OLD")
  assert.equal((await run(service.updateDraft({ draftId: draft.id, ...header, series: "OLD" }))).series, "OLD")
  const edited = await run(service.addDraftLine({ draftId: draft.id, ...line, description: "Încă o linie" }))
  assert.equal(edited.lines.length, 2)
  await expectConflict(service.issueInvoice(idempotent({ draftId: draft.id })), "document_series_archived")
  const sequences = structuredClone(state.sequences)
  // A move to an archived series is refused and leaves the draft where it was.
  await run(service.setDocumentSeriesArchived({ documentType: "invoice", series: "SPARE", archived: true }))
  await expectConflict(service.updateDraft({ draftId: draft.id, ...header, series: "SPARE" }), "document_series_archived")
  assert.equal((await run(service.getDraft(draft.id))).series, "OLD")
  const moved = await run(service.updateDraft({ draftId: draft.id, ...header, series: "NEW" }))
  // The move keeps the draft itself: its id, its notes and its lines.
  assert.deepEqual({ ...moved, series: "OLD" }, edited)
  const invoice = await run(service.issueInvoice(idempotent({ draftId: draft.id })))
  assert.deepEqual([invoice.series, invoice.number, invoice.draftId], ["NEW", 1, draft.id])
  assert.notDeepEqual(state.sequences, sequences)
  await expectConflict(service.updateDraft({ draftId: draft.id, ...header, series: "NEW" }), "invoice_already_issued")
})

void test("a draft moves only to a configured invoice series of a valid name", async () => {
  const { service, state, draft } = await configured()
  const before = structuredClone(state.drafts)
  const unknown = await flip(service.updateDraft({ draftId: draft.id, ...header, series: "ZZZ" }))
  assert.ok(unknown instanceof ResourceNotFound && unknown.resource === "document_series")
  // A proforma series is not an invoice series.
  assert.ok(await flip(service.updateDraft({ draftId: draft.id, ...header, series: "PRO" })) instanceof ResourceNotFound)
  assert.ok(await flip(service.updateDraft({ draftId: draft.id, ...header, series: "lower" })) instanceof ValidationFailure)
  assert.deepEqual(state.drafts, before)
  // Deleting stays the other way out of an archived series.
  await run(service.deleteDraft(draft.id))
  assert.equal(state.drafts.has(draft.id), false)
})

void test("a draft converted from a proforma keeps its lineage when it changes series", async () => {
  const { service } = await configured()
  const proforma = await run(service.issueProforma(idempotent({ ...header, currency: "RON", proformaSeries: "PRO", lines: [line] })))
  const derived = await run(service.createDraftInvoiceFromProforma(idempotent({ proformaId: proforma.id, invoiceSeries: "NEW" })))
  const moved = await run(service.updateDraft({ draftId: derived.id, ...header, series: "SPARE" }))
  assert.deepEqual([moved.id, moved.series, moved.sourceProformaId], [derived.id, "SPARE", proforma.id])
})
