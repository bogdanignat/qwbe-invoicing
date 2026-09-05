import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService, type InvoicingTransaction } from "../../application/invoicing.ts"
import { contextProvider, each, emptyState, expectConflict, fixedClock, identity, idempotent, memoryStore, sequentialIds, vatConfigurations } from "../../application/memory-store.test-support.ts"
import { DomainConflict, PermissionDenied, ResourceNotFound, ValidationFailure, type TransactionalStore } from "../../contracts/index.ts"

void test("issues deterministic immutable invoice snapshots through the public service", async () => {
  const state = emptyState()
  const service = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: fixedClock,
    ids: sequentialIds(),
    store: memoryStore(state),
    cubeIdentity: "invoicing",
  })

  await Effect.runPromise(service.configureIssuer({
    name: "Exemplu SRL",
    fiscalIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    vatConfigurations,
  }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "ALT" }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
  assert.deepEqual(await Effect.runPromise(service.listDocumentSeries()), [
    { organizationId: "org-1", documentType: "invoice", series: "ALT" },
    { organizationId: "org-1", documentType: "invoice", series: "QWBE" },
    { organizationId: "org-1", documentType: "proforma", series: "PRO" },
  ])
  const duplicateSeries = await Effect.runPromise(Effect.flip(
    service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }),
  ))
  assert.equal(duplicateSeries instanceof DomainConflict && duplicateSeries.code === "document_series_exists", true)
  const customer = await Effect.runPromise(service.createCustomer({
    partyType: "company",
    name: "Client SRL",
    fiscalIdentifier: "RO87654329",
    address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2" },
  }))
  const unknownSeries = await Effect.runPromise(Effect.flip(service.createDraft({
    customerId: customer.id,
    issueDate: "2026-09-01",
    series: "UNKNOWN",
  })))
  assert.equal(unknownSeries instanceof ResourceNotFound && unknownSeries.resource === "document_series", true)
  const invalidDueDate = await Effect.runPromise(Effect.flip(service.createDraft({
    customerId: customer.id,
    issueDate: "2026-09-01",
    series: "QWBE",
    dueDate: "2026-08-31",
  })))
  assert.equal(invalidDueDate instanceof ValidationFailure, true)
  const invalidCurrency = await Effect.runPromise(Effect.flip(service.createDraft({
    customerId: customer.id,
    issueDate: "2026-09-01",
    series: "QWBE",
    currency: "EUR",
  })))
  assert.equal(invalidCurrency instanceof ValidationFailure && invalidCurrency.issues.includes("currency must be RON"), true)
  const draft = await Effect.runPromise(service.createDraft({
    customerId: customer.id,
    issueDate: "2026-09-01",
    series: "QWBE",
  }))
  assert.equal(draft.series, "QWBE")
  assert.equal(draft.dueDate, null)
  await Effect.runPromise(service.addDraftLine({
    draftId: draft.id,
    description: "Servicii software",
    quantity: "1.2500",
    unitPrice: "100.00",
    unitOfMeasure: each,
    vatRateCode: "RO_STANDARD",
  }))

  const issued = await Effect.runPromise(service.issueInvoice(idempotent({ draftId: draft.id })))
  assert.equal(issued.number, 1)
  assert.equal(issued.series, "QWBE")
  assert.equal(issued.totalExcludingVat, "125.00")
  assert.equal(issued.vatTotal, "26.25")
  assert.equal(issued.totalIncludingVat, "151.25")
  assert.equal(issued.issuer.name, "Exemplu SRL")
  assert.equal(issued.customer.name, "Client SRL")
  assert.deepEqual(await Effect.runPromise(service.listIssuedInvoices()), { items: [issued], nextCursor: null })

  await Effect.runPromise(service.configureIssuer({
    name: "Exemplu Renamed SRL",
    fiscalIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Altă stradă 3" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 30,
    vatConfigurations,
  }))
  const preserved = await Effect.runPromise(service.getIssuedInvoice(issued.id))
  assert.equal(preserved.issuer.name, "Exemplu SRL")
  assert.equal(preserved.series, "QWBE")

  await Effect.runPromise(service.deleteCustomer(customer.id))
  assert.deepEqual(await Effect.runPromise(service.listCustomers()), { items: [], nextCursor: null })
  const deletedCustomer = await Effect.runPromise(Effect.flip(service.getCustomer(customer.id)))
  assert.equal(deletedCustomer instanceof ResourceNotFound, true)
  const newDraft = await Effect.runPromise(Effect.flip(service.createDraft({
    customerId: customer.id,
    issueDate: "2026-09-02",
    series: "QWBE",
  })))
  assert.equal(newDraft instanceof ResourceNotFound, true)
  assert.equal((await Effect.runPromise(service.getIssuedInvoice(issued.id))).customer.name, "Client SRL")
})

void test("failed invoice and proforma issuance rolls back both the document and its number", async () => {
  const state = emptyState()
  const baseStore = memoryStore(state)
  const failingStore: TransactionalStore<InvoicingTransaction> = {
    transaction: (use) => baseStore.transaction((transaction) => use({
      ...transaction,
      saveIssuedInvoice: () => Effect.fail(new DomainConflict({ code: "forced_failure", message: "forced" })),
      saveProforma: () => Effect.fail(new DomainConflict({ code: "forced_failure", message: "forced" })),
    })),
  }
  const service = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: fixedClock,
    ids: sequentialIds(),
    store: failingStore,
    cubeIdentity: "invoicing",
  })

  await Effect.runPromise(service.configureIssuer({
    name: "Exemplu SRL",
    fiscalIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    vatConfigurations,
  }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
  const customer = await Effect.runPromise(service.createCustomer({
    partyType: "company",
    name: "Client SRL",
    fiscalIdentifier: "RO87654329",
    address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2" },
  }))
  const draft = await Effect.runPromise(service.createDraft({ customerId: customer.id, issueDate: "2026-09-01", series: "QWBE" }))
  const deletion = await Effect.runPromise(Effect.flip(service.deleteCustomer(customer.id)))
  assert.equal(deletion instanceof DomainConflict && deletion.code === "customer_has_open_drafts", true)
  await Effect.runPromise(service.addDraftLine({
    draftId: draft.id,
    description: "Servicii",
    quantity: "1",
    unitPrice: "100",
    unitOfMeasure: each,
    vatRateCode: "RO_STANDARD",
  }))

  const invoiceFailure = await Effect.runPromise(Effect.flip(service.issueInvoice(idempotent({ draftId: draft.id }))))
  assert.equal(invoiceFailure instanceof DomainConflict && invoiceFailure.code === "forced_failure", true)
  assert.equal(state.sequences.size, 0)
  assert.equal(state.issued.size, 0)
  assert.equal(state.drafts.get(draft.id)?.status, "draft")

  const proformaDraft = await Effect.runPromise(service.createDraft({ customerId: customer.id, issueDate: "2026-09-01", series: "QWBE" }))
  await Effect.runPromise(service.addDraftLine({
    draftId: proformaDraft.id,
    description: "Avans",
    quantity: "1",
    unitPrice: "50",
    unitOfMeasure: each,
    vatRateCode: "RO_STANDARD",
  }))
  const proformaFailure = await Effect.runPromise(Effect.flip(service.issueProforma(idempotent({ draftId: proformaDraft.id, series: "PRO" }))))
  assert.equal(proformaFailure instanceof DomainConflict && proformaFailure.code === "forced_failure", true)
  assert.equal(state.sequences.size, 0)
  assert.equal(state.proformas.size, 0)
  assert.equal(state.drafts.get(proformaDraft.id)?.status, "draft")
})

void test("issues immutable proformas from saved drafts", async () => {
  const state = emptyState()
  const service = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-1" } }), clock: fixedClock,
    ids: sequentialIds(), store: memoryStore(state), cubeIdentity: "invoicing",
  })
  await Effect.runPromise(service.configureIssuer({
    name: "Exemplu SRL", fiscalIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON", defaultPaymentTermDays: 15, vatConfigurations,
  }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "SAME" }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "SAME" }))
  const buyer = { partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "RO87654329",
    address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2" } }
  const savedCustomer = await Effect.runPromise(service.createCustomer(buyer))
  const source = await Effect.runPromise(service.createDraft({ customerId: savedCustomer.id, series: "SAME", issueDate: "2026-09-01", dueDate: null }))
  await Effect.runPromise(service.addDraftLine({
    draftId: source.id, description: "Servicii", quantity: "1", unitPrice: "100", unitOfMeasure: each, vatRateCode: "RO_STANDARD",
  }))
  const proforma = await Effect.runPromise(service.issueProforma(idempotent({ draftId: source.id, series: "SAME" })))
  assert.equal(proforma.number, 1)
  assert.equal(proforma.dueDate, null)
  assert.equal(proforma.convertedDraftId, null)
  assert.equal((await Effect.runPromise(service.getProforma(proforma.id))).convertedDraftId, null)
  assert.equal((await Effect.runPromise(service.listProformas())).items[0]?.convertedDraftId, null)
  assert.equal((await Effect.runPromise(service.getDraft(source.id))).status, "proforma_issued")
  await expectConflict(service.deleteDraft(source.id), "draft_already_issued")
  await expectConflict(service.issueInvoice(idempotent({ draftId: source.id })), "invoice_already_issued")
  await expectConflict(service.issueProforma(idempotent({ draftId: source.id, series: "SAME" })), "draft_already_issued")
  await expectConflict(service.addDraftLine({
    draftId: source.id, description: "X", quantity: "1", unitPrice: "1", unitOfMeasure: each, vatRateCode: "RO_STANDARD",
  }), "draft_already_issued")

  const invoiceSource = await Effect.runPromise(service.createDraft({ customer: buyer, series: "SAME", issueDate: "2026-09-01" }))
  await Effect.runPromise(service.addDraftLine({ draftId: invoiceSource.id, description: "Direct", quantity: "1", unitPrice: "10", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }))
  assert.equal((await Effect.runPromise(service.issueInvoice(idempotent({ draftId: invoiceSource.id })))).number, 1)
  assert.equal((await Effect.runPromise(service.listProformas())).items[0]?.convertedDraftId, null)

  const denied = createInvoicingService({
    context: contextProvider({ identity: { ...identity, permissions: identity.permissions.filter((p) => p !== "invoicing:proforma.issue") }, organization: { id: "org-1" } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), cubeIdentity: "invoicing",
  })
  assert.equal(await Effect.runPromise(Effect.flip(denied.issueProforma(idempotent({ draftId: source.id, series: "SAME" })))) instanceof PermissionDenied, true)
  const other = createInvoicingService({ context: contextProvider({ identity, organization: { id: "org-2" } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), cubeIdentity: "invoicing" })
  assert.equal(await Effect.runPromise(Effect.flip(other.getProforma(proforma.id))) instanceof ResourceNotFound, true)
  assert.equal(await Effect.runPromise(Effect.flip(other.issueInvoiceFromProforma(idempotent({ proformaId: proforma.id })))) instanceof ResourceNotFound, true)
})

void test("issues authored documents without drafts and invoices a proforma snapshot exactly once", async () => {
  const state = emptyState()
  const service = createInvoicingService({ context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), cubeIdentity: "invoicing" })
  await Effect.runPromise(service.configureIssuer({ name: "Exemplu SRL", fiscalIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" }, defaultCurrency: "RON",
    defaultPaymentTermDays: 15, vatConfigurations }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "INV" }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
  const customer = { partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "RO87654329",
    address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2" } }
  const input = { customer, series: "INV", issueDate: "2026-09-01", dueDate: null, currency: "RON" as const,
    lines: [{ description: "Avans", quantity: "2", unitPrice: "50", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }] }
  const invoice = await Effect.runPromise(service.issueInvoice(idempotent(input)))
  assert.equal(invoice.draftId, null)
  assert.equal(invoice.sourceProformaId, null)
  assert.equal(state.drafts.size, 0)
  const proforma = await Effect.runPromise(service.issueProforma(idempotent({ ...input, proformaSeries: "PRO" })))
  assert.equal(proforma.sourceDraftId, null)
  assert.equal(proforma.invoiceSeries, "INV")
  assert.equal(state.drafts.size, 0)
  const converted = await Effect.runPromise(service.issueInvoiceFromProforma(idempotent({ proformaId: proforma.id })))
  assert.equal(converted.draftId, null)
  assert.equal(converted.sourceProformaId, proforma.id)
  assert.deepEqual([converted.issuer, converted.customer, converted.lines, converted.vatBreakdown, converted.issueDate,
    converted.dueDate, converted.currency, converted.totalExcludingVat, converted.vatTotal, converted.totalIncludingVat],
  [proforma.issuer, proforma.customer, proforma.lines, proforma.vatBreakdown, proforma.issueDate,
    proforma.dueDate, proforma.currency, proforma.totalExcludingVat, proforma.vatTotal, proforma.totalIncludingVat])
  assert.equal(state.invoiceConversions.get(proforma.id)?.actorId, identity.id)
  await expectConflict(service.issueInvoiceFromProforma(idempotent({ proformaId: proforma.id })), "proforma_already_converted")
  const rollbackSource = await Effect.runPromise(service.issueProforma(idempotent({ ...input, proformaSeries: "PRO" })))
  const invoiceCount = state.issued.size
  const invoiceSequence = state.sequences.get("org-1:2026:invoice:INV")
  const failing = createInvoicingService({ context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: fixedClock, ids: sequentialIds(), cubeIdentity: "invoicing", store: {
      transaction: (use) => memoryStore(state).transaction((transaction) => use({ ...transaction,
        saveProformaInvoiceConversion: () => Effect.fail(new DomainConflict({ code: "forced_failure", message: "forced" })) })),
    } })
  await expectConflict(failing.issueInvoiceFromProforma(idempotent({ proformaId: rollbackSource.id })), "forced_failure")
  assert.equal(state.issued.size, invoiceCount)
  assert.equal(state.sequences.get("org-1:2026:invoice:INV"), invoiceSequence)
  const other = createInvoicingService({ context: contextProvider({ identity, organization: { id: "org-2" } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), cubeIdentity: "invoicing" })
  assert.equal(await Effect.runPromise(Effect.flip(other.issueInvoiceFromProforma(idempotent({ proformaId: proforma.id })))) instanceof ResourceNotFound, true)
})
