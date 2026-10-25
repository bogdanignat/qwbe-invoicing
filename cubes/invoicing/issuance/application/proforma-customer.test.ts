import assert from "node:assert/strict"
import test from "node:test"
import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { brandingNormalizer, contextProvider, each, emptyState, expectConflict, identity, idempotent, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"
import { ResourceNotFound } from "../../contracts/failures.ts"

// T-2088: a proforma keeps the saved customer it was issued for, so the draft made from it stays linked to that
// customer (and so to its payment term) while the customer still exists in the organization.
const address = { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" }
const line = { description: "Serviciu", quantity: "1", unitPrice: "100", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }
const company = { partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true, address }

const setup = async () => {
  const state = emptyState()
  const service = (organization: string) => createInvoicingService({ context: contextProvider({ identity, organization: { id: organization } }),
    clock: { now: Effect.succeed(new Date("2026-09-01T10:00:00.000Z")) }, ids: sequentialIds(), store: memoryStore(state),
    branding: brandingNormalizer, cubeIdentity: "invoicing" })
  const org1 = service("org-1")
  await Effect.runPromise(org1.configureIssuer({ name: "Emitent SRL", fiscalIdentifier: "12345674", address, legalForm: "srl",
    tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", iban: "", bankName: "", branding: null, defaultCurrency: "RON",
    defaultPaymentTermDays: 15, vatChange: { registered: true, effectiveFrom: "2025-01-01" } }))
  await Effect.runPromise(org1.addDocumentSeries({ documentType: "invoice", series: "INV" }))
  await Effect.runPromise(org1.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
  const customer = await Effect.runPromise(org1.createCustomer({ ...company, defaultPaymentTermDays: 30 }))
  const proformaFor = (buyer: { customerId: string } | { customer: typeof company }, dueDate: string | null = null) =>
    Effect.runPromise(org1.issueProforma(idempotent({ ...buyer, proformaSeries: "PRO", issueDate: "2026-09-01", dueDate, currency: "RON", lines: [line] })))
  const toDraft = (proformaId: string) => Effect.runPromise(org1.createDraftInvoiceFromProforma(idempotent({ proformaId, invoiceSeries: "INV" })))
  return { state, service, org1, customer, proformaFor, toDraft }
}

void test("a direct proforma keeps its saved customer and its draft stays linked to it", async () => {
  const { org1, customer, proformaFor, toDraft } = await setup()
  const proforma = await proformaFor({ customerId: customer.id })
  assert.equal(proforma.customerId, customer.id)
  assert.equal((await Effect.runPromise(org1.getProforma(proforma.id))).customerId, customer.id)
  const draft = await toDraft(proforma.id)
  assert.equal(draft.customerId, customer.id)
  assert.deepEqual(draft.customer, proforma.customer)
  // No due date on the proforma: the draft leaves it to the customer's term, which the screen proposes (T-2087).
  assert.equal(draft.dueDate, null)
  // The linked draft is an open draft of that customer, like any other.
  await expectConflict(org1.deleteCustomer(customer.id), "customer_has_open_drafts")
})

void test("a proforma with a due date keeps its own term on the draft", async () => {
  const { customer, proformaFor, toDraft } = await setup()
  const draft = await toDraft((await proformaFor({ customerId: customer.id }, "2026-09-11")).id)
  assert.equal(draft.customerId, customer.id)
  assert.equal(draft.dueDate, "2026-09-11")
})

void test("a proforma issued from a draft copies the draft's customer", async () => {
  const { org1, customer } = await setup()
  const source = await Effect.runPromise(org1.createDraft(idempotent({ customerId: customer.id, issueDate: "2026-09-01", series: "INV", lines: [line] })))
  const proforma = await Effect.runPromise(org1.issueProforma(idempotent({ draftId: source.id, series: "PRO" })))
  assert.equal(proforma.customerId, customer.id)
})

void test("an occasional proforma and its draft carry no customer", async () => {
  const { proformaFor, toDraft } = await setup()
  const proforma = await proformaFor({ customer: company })
  assert.equal("customerId" in proforma, false)
  const draft = await toDraft(proforma.id)
  assert.equal("customerId" in draft, false)
  assert.deepEqual(draft.customer, proforma.customer)
})

void test("deleting the customer is not blocked by its proformas; the draft is then occasional", async () => {
  const { org1, customer, proformaFor, toDraft } = await setup()
  const proforma = await proformaFor({ customerId: customer.id })
  await Effect.runPromise(org1.deleteCustomer(customer.id))
  const draft = await toDraft(proforma.id)
  assert.equal("customerId" in draft, false)
  assert.deepEqual(draft.customer, proforma.customer)
})

void test("a customer of another organization is refused at issuance and never linked at conversion", async () => {
  const { state, service, proformaFor, toDraft } = await setup()
  const foreign = await Effect.runPromise(service("org-2").createCustomer(company))
  const before = state.proformas.size
  const refused = await Effect.runPromise(Effect.flip(service("org-1").issueProforma(idempotent({ customerId: foreign.id,
    proformaSeries: "PRO", issueDate: "2026-09-01", currency: "RON", lines: [line] }))))
  assert.ok(refused instanceof ResourceNotFound && refused.resource === "customer")
  assert.equal(state.proformas.size, before)
  // A forged link (the database refuses it by key) is re-read in the organization and dropped.
  const proforma = await proformaFor({ customer: company })
  state.proformas.set(proforma.id, { ...proforma, customerId: foreign.id })
  assert.equal("customerId" in (await toDraft(proforma.id)), false)
})
