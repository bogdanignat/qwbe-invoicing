import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import {
  brandingNormalizer, contextProvider, each, emptyState, expectConflict, fixedClock, identity, idempotent, memoryStore, sequentialIds,
} from "../../application/memory-store.test-support.ts"
import { PermissionDenied, ResourceNotFound, ValidationFailure } from "../../contracts/index.ts"

/**
 * T-2082: an archived series keeps its documents and its counter but takes no
 * new document; only a storno still lands in it, beside the invoice it corrects.
 */

const customer = {
  partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
  address: { countryCode: "RO", city: "Iași", street: "Strada 2", county: "RO-IS" },
}
const lines = [{ description: "Servicii", quantity: "1", unitPrice: "10", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }]
const document = { customer, issueDate: "2026-09-01", dueDate: "2026-09-15", currency: "RON" as const, lines }
const archived = "document_series_archived"

const setup = (permissions = identity.permissions, organizationId = "org-1", state = emptyState()) => {
  const service = createInvoicingService({
    context: contextProvider({ identity: { ...identity, permissions }, organization: { id: organizationId } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), branding: brandingNormalizer, cubeIdentity: "invoicing",
  })
  return { service, state }
}

const configured = async () => {
  const rig = setup()
  const run = Effect.runPromise
  await run(rig.service.configureIssuer({
    name: "Exemplu SRL", fiscalIdentifier: "12345674", address: { countryCode: "RO", city: "Botoșani", street: "Strada 1", county: "RO-BT" },
    legalForm: "srl", tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca", socialCapital: "1000.00",
    defaultCurrency: "RON", defaultPaymentTermDays: 15, vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null,
  }))
  for (const series of ["FCT", "NEW"]) await run(rig.service.addDocumentSeries({ documentType: "invoice", series }))
  for (const series of ["PRO", "PRO2"]) await run(rig.service.addDocumentSeries({ documentType: "proforma", series }))
  const archive = (documentType: "invoice" | "proforma", series: string, value = true) =>
    run(rig.service.setDocumentSeriesArchived({ documentType, series, archived: value }))
  return { ...rig, run, archive }
}

void test("archiving answers the whole series, writes once with its audit and leaves the list complete", async () => {
  const { service, state, run, archive } = await configured()
  const audits = () => state.auditEvents.filter(({ action }) => action.startsWith("series.") && action !== "series.added")
    .map(({ action, targetId }) => `${action} ${targetId}`)
  assert.deepEqual(await archive("invoice", "FCT"), { organizationId: "org-1", documentType: "invoice", series: "FCT", archived: true })
  // The same state again is answered as it is, without a write or an audit.
  const before = structuredClone(state)
  assert.deepEqual(await archive("invoice", "FCT"), { organizationId: "org-1", documentType: "invoice", series: "FCT", archived: true })
  assert.deepEqual(state, before)
  assert.deepEqual((await run(service.listDocumentSeries())).map(({ series, archived: flag }) => `${series}:${String(flag)}`),
    ["FCT:true", "NEW:false", "PRO:false", "PRO2:false"])
  assert.deepEqual(await archive("invoice", "FCT", false), { organizationId: "org-1", documentType: "invoice", series: "FCT", archived: false })
  assert.deepEqual(audits(), ["series.archived invoice:FCT", "series.reactivated invoice:FCT"])
})

void test("archiving needs the settings permission, an existing series of the organization and a valid name", async () => {
  const { state, archive } = await configured()
  const reader = setup(["invoicing:read"], "org-1", state)
  const other = setup(identity.permissions, "org-2", state)
  const flip = <Value, Failure>(effect: Effect.Effect<Value, Failure>) => Effect.runPromise(Effect.flip(effect))
  const input = { documentType: "invoice" as const, series: "FCT", archived: true }
  assert.ok(await flip(reader.service.setDocumentSeriesArchived(input)) instanceof PermissionDenied)
  // Another organization does not see the series, so it cannot archive it either.
  assert.ok(await flip(other.service.setDocumentSeriesArchived(input)) instanceof ResourceNotFound)
  const unknown = await flip(other.service.setDocumentSeriesArchived({ ...input, series: "ZZZ" }))
  assert.ok(unknown instanceof ResourceNotFound && unknown.resource === "document_series")
  assert.ok(await flip(other.service.setDocumentSeriesArchived({ ...input, series: "lower" })) instanceof ValidationFailure)
  assert.equal(state.auditEvents.some(({ action }) => action === "series.archived"), false)
  // Archiving the last active invoice series is allowed: the setup gaps say what is missing.
  await archive("invoice", "FCT")
  await archive("invoice", "NEW")
})

void test("every way into an archived series is refused before a number is taken", async () => {
  const { service, state, run, archive } = await configured()
  const draft = await run(service.createDraft(idempotent({ customer, series: "FCT", issueDate: "2026-09-01", lines })))
  const proforma = await run(service.issueProforma(idempotent({ ...document, proformaSeries: "PRO" })))
  await archive("invoice", "FCT")
  await archive("proforma", "PRO")
  const sequences = structuredClone(state.sequences)
  await expectConflict(service.createDraft(idempotent({ customer, series: "FCT", issueDate: "2026-09-01" })), archived)
  await expectConflict(service.issueInvoice(idempotent({ ...document, series: "FCT" })), archived)
  // The series is read again when the draft is issued: it was active when the draft was saved.
  await expectConflict(service.issueInvoice(idempotent({ draftId: draft.id })), archived)
  await expectConflict(service.issueProforma(idempotent({ ...document, proformaSeries: "PRO" })), archived)
  await expectConflict(service.issueProforma(idempotent({ draftId: draft.id, series: "PRO" })), archived)
  await expectConflict(service.issueInvoiceFromProforma(idempotent({ proformaId: proforma.id, invoiceSeries: "FCT" })), archived)
  await expectConflict(service.createDraftInvoiceFromProforma(idempotent({ proformaId: proforma.id, invoiceSeries: "FCT" })), archived)
  assert.deepEqual(state.sequences, sequences)
  assert.equal(state.drafts.get(draft.id)?.status, "draft")
})

void test("the archived series of the source does not block: a proforma converts and a draft becomes a proforma elsewhere", async () => {
  const { service, run, archive } = await configured()
  const proforma = await run(service.issueProforma(idempotent({ ...document, proformaSeries: "PRO" })))
  const draft = await run(service.createDraft(idempotent({ customer, series: "FCT", issueDate: "2026-09-01", lines })))
  await archive("proforma", "PRO")
  await archive("invoice", "FCT")
  const converted = await run(service.issueInvoiceFromProforma(idempotent({ proformaId: proforma.id, invoiceSeries: "NEW" })))
  assert.deepEqual([converted.series, converted.number], ["NEW", 1])
  // A proforma is numbered in the series of the request; the draft's invoice series is not used.
  const fromDraft = await run(service.issueProforma(idempotent({ draftId: draft.id, series: "PRO2" })))
  assert.deepEqual([fromDraft.series, fromDraft.number], ["PRO2", 1])
})

void test("a storno stays in the archived series, reactivation continues the counter and a replay still answers", async () => {
  const { service, run, archive } = await configured()
  const key = "issue-before-archive"
  const first = await run(service.issueInvoice(idempotent({ ...document, series: "FCT" }, key)))
  await archive("invoice", "FCT")
  // A retry of an issuance that succeeded is answered from its record, archived series or not.
  assert.deepEqual(await run(service.issueInvoice(idempotent({ ...document, series: "FCT" }, key))), first)
  const storno = await run(service.createCorrection(idempotent({ originalInvoiceId: first.id, reason: "Storno" })))
  assert.deepEqual([storno.series, storno.number], ["FCT", 2])
  await archive("invoice", "FCT", false)
  const next = await run(service.issueInvoice(idempotent({ ...document, series: "FCT" })))
  assert.deepEqual([next.series, next.number], ["FCT", 3])
  // Archiving never touches what was issued.
  assert.deepEqual(await run(service.getIssuedInvoice(first.id)), first)
})
