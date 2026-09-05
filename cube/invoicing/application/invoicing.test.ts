import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import {
  createInvoicingService,
  type DraftInvoice,
  type InvoicingTransaction,
  type IssuedInvoice,
  type Proforma,
} from "./invoicing.ts"
import {
  DomainConflict,
  PermissionDenied,
  ResourceNotFound,
  ValidationFailure,
  type Clock,
  type IdGenerator,
  type InvoicingFailure,
  type RequestContext,
  type RequestContextProvider,
  type TransactionalStore,
} from "../contracts/index.ts"
import type { IdempotencyRecord, ProformaConversion } from "../domain/invoice.ts"

interface MemoryState {
  issuers: Map<string, Parameters<InvoicingTransaction["saveIssuer"]>[0]>
  documentSeries: Map<string, Parameters<InvoicingTransaction["addDocumentSeries"]>[0]>
  customers: Map<string, Parameters<InvoicingTransaction["saveCustomer"]>[0]>
  productPresets: Map<string, Parameters<InvoicingTransaction["saveProductPreset"]>[0]>
  drafts: Map<string, DraftInvoice>
  issued: Map<string, IssuedInvoice>
  proformas: Map<string, Proforma>
  conversions: Map<string, ProformaConversion>
  invoiceConversions: Map<string, Parameters<InvoicingTransaction["saveProformaInvoiceConversion"]>[0]>
  sequences: Map<string, number>
  corrections: Map<string, Parameters<InvoicingTransaction["saveCorrection"]>[0]>
  idempotency: Map<string, IdempotencyRecord>
}

const cloneState = (state: MemoryState): MemoryState => structuredClone(state)

const memoryStore = (state: MemoryState): TransactionalStore<InvoicingTransaction> => ({
  transaction: (use) => Effect.suspend(() => {
    const working = cloneState(state)
    const transaction: InvoicingTransaction = {
      saveIssuer: (issuer) => Effect.sync(() => { working.issuers.set(issuer.organizationId, issuer) }),
      findIssuer: (organizationId) => Effect.succeed(working.issuers.get(organizationId)),
      addDocumentSeries: (documentSeries) => Effect.suspend(() => {
        const key = `${documentSeries.organizationId}:${documentSeries.documentType}:${documentSeries.series}`
        return working.documentSeries.has(key)
          ? Effect.fail(new DomainConflict({ code: "document_series_exists", message: "Document series already exists" }))
          : Effect.sync(() => { working.documentSeries.set(key, documentSeries) })
      }),
      findDocumentSeries: (organizationId, documentType, series) => Effect.succeed(
        working.documentSeries.get(`${organizationId}:${documentType}:${series}`),
      ),
      listDocumentSeries: (organizationId) => Effect.succeed(
        [...working.documentSeries.values()].filter((item) => item.organizationId === organizationId)
          .sort((left, right) => left.documentType.localeCompare(right.documentType) || left.series.localeCompare(right.series)),
      ),
      saveCustomer: (customer) => Effect.sync(() => { working.customers.set(customer.id, customer) }),
      findCustomer: (organizationId, id) => Effect.succeed(
        working.customers.get(id)?.organizationId === organizationId ? working.customers.get(id) : undefined,
      ),
      listCustomers: (organizationId) => Effect.succeed(
        [...working.customers.values()]
          .filter((customer) => customer.organizationId === organizationId && customer.deletedAt === undefined)
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          .slice(0, 100),
      ),
      softDeleteCustomer: (organizationId, id, deletedAt) => Effect.sync(() => {
        const customer = working.customers.get(id)
        if (customer === undefined || customer.organizationId !== organizationId) {
          throw new DomainConflict({ code: "customer_not_found", message: "Customer not found" })
        }
        working.customers.set(id, { ...customer, deletedAt })
      }),
      hasOpenDraftsForCustomer: (organizationId, customerId) => Effect.succeed(
        [...working.drafts.values()].some((draft) =>
          draft.organizationId === organizationId && draft.customerId === customerId && draft.status === "draft"),
      ),
      saveProductPreset: (preset) => Effect.sync(() => { working.productPresets.set(preset.id, preset) }),
      findProductPreset: (organizationId, id) => Effect.succeed(
        working.productPresets.get(id)?.organizationId === organizationId ? working.productPresets.get(id) : undefined,
      ),
      listProductPresets: (organizationId) => Effect.succeed([...working.productPresets.values()]
        .filter((preset) => preset.organizationId === organizationId)
        .sort((a, b) => a.description.localeCompare(b.description) || a.id.localeCompare(b.id))),
      deleteProductPreset: (organizationId, id) => Effect.sync(() => {
        if (working.productPresets.get(id)?.organizationId === organizationId) working.productPresets.delete(id)
      }),
      saveDraft: (draft) => Effect.sync(() => { working.drafts.set(draft.id, draft) }),
      findDraft: (organizationId, id) => Effect.succeed(
        working.drafts.get(id)?.organizationId === organizationId ? working.drafts.get(id) : undefined,
      ),
      listDrafts: (organizationId, source) => Effect.succeed([...working.drafts.values()]
        .filter((draft) => draft.organizationId === organizationId && draft.status === "draft"
          && (source === undefined || (draft.source?.app === source.app && draft.source.kind === source.kind && draft.source.id === source.id)))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || a.id.localeCompare(b.id))),
      deleteDraft: (organizationId, id) => Effect.sync(() => {
        const draft = working.drafts.get(id)
        if (draft === undefined || draft.organizationId !== organizationId || draft.status !== "draft") {
          throw new DomainConflict({ code: "draft_not_editable", message: "Draft cannot be deleted" })
        }
        working.drafts.delete(id)
      }),
      allocateDocumentNumber: (organizationId, fiscalYear, documentType, series) => Effect.sync(() => {
        const key = `${organizationId}:${String(fiscalYear)}:${documentType}:${series}`
        const next = (working.sequences.get(key) ?? 0) + 1
        working.sequences.set(key, next)
        return next
      }),
      saveIssuedInvoice: (invoice) => Effect.sync(() => { working.issued.set(invoice.id, invoice) }),
      findIssuedInvoice: (organizationId, id) => Effect.succeed(
        working.issued.get(id)?.organizationId === organizationId ? working.issued.get(id) : undefined,
      ),
      listIssuedInvoices: (organizationId, source) => Effect.succeed(
        [...working.issued.values()]
          .filter((invoice) => invoice.organizationId === organizationId
            && (source === undefined || (invoice.source?.app === source.app && invoice.source.kind === source.kind && invoice.source.id === source.id)))
          .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number - a.number || a.id.localeCompare(b.id))
          .slice(0, 100),
      ),
      saveProforma: (proforma) => Effect.sync(() => { working.proformas.set(proforma.id, proforma) }),
      findProforma: (organizationId, id) => Effect.sync(() => {
        const value = working.proformas.get(id)
        const conversion = working.conversions.get(id)
        return value?.organizationId === organizationId
          ? { ...value, convertedDraftId: conversion?.resultingDraftId ?? null,
            convertedInvoiceId: working.invoiceConversions.get(id)?.resultingInvoiceId ?? null }
          : undefined
      }),
      listProformas: (organizationId, source) => Effect.succeed([...working.proformas.values()]
        .filter((value) => value.organizationId === organizationId
          && (source === undefined || (value.source?.app === source.app && value.source.kind === source.kind && value.source.id === source.id)))
        .map((value) => ({ ...value, convertedDraftId: working.conversions.get(value.id)?.resultingDraftId ?? null,
          convertedInvoiceId: working.invoiceConversions.get(value.id)?.resultingInvoiceId ?? null }))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number - a.number)),
      findProformaConversion: (organizationId, proformaId) => Effect.succeed(
        working.conversions.get(proformaId)?.organizationId === organizationId ? working.conversions.get(proformaId) : undefined,
      ),
      findProformaInvoiceConversion: (organizationId, proformaId) => Effect.succeed(
        working.invoiceConversions.get(proformaId)?.organizationId === organizationId ? working.invoiceConversions.get(proformaId) : undefined,
      ),
      saveProformaInvoiceConversion: (conversion) => working.invoiceConversions.has(conversion.proformaId)
        ? Effect.fail(new DomainConflict({ code: "proforma_already_converted", message: "Proforma was already converted" }))
        : Effect.sync(() => { working.invoiceConversions.set(conversion.proformaId, conversion) }),
      saveCorrection: (correction) => Effect.sync(() => { working.corrections.set(correction.id, correction) }),
      findCorrection: (organizationId, id) => Effect.succeed(
        working.corrections.get(id)?.organizationId === organizationId ? working.corrections.get(id) : undefined,
      ),
      listCorrections: (organizationId, originalInvoiceId, source) => Effect.succeed(
        [...working.corrections.values()].filter((c) => c.organizationId === organizationId && c.originalInvoiceId === originalInvoiceId
          && (source === undefined || (c.source?.app === source.app && c.source.kind === source.kind && c.source.id === source.id)))
          .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt)),
      ),
      findIdempotencyRecord: (organizationId, key) => Effect.succeed(working.idempotency.get(`${organizationId}:${key}`)),
      saveIdempotencyRecord: (record) => Effect.sync(() => { working.idempotency.set(`${record.organizationId}:${record.key}`, record) }),
    }
    return Effect.tap(use(transaction), () => Effect.sync(() => {
      state.issuers = working.issuers
      state.documentSeries = working.documentSeries
      state.customers = working.customers
      state.productPresets = working.productPresets
      state.drafts = working.drafts
      state.issued = working.issued
      state.proformas = working.proformas
      state.conversions = working.conversions
      state.invoiceConversions = working.invoiceConversions
      state.sequences = working.sequences
      state.corrections = working.corrections
      state.idempotency = working.idempotency
    }))
  }),
})

const identity = {
  id: "user-1",
  username: "owner",
  roles: ["admin"],
  permissions: [
    "invoicing:read",
    "invoicing:customer.manage",
    "invoicing:invoice.draft",
    "invoicing:invoice.issue",
    "invoicing:proforma.issue",
    "invoicing:invoice.void",
    "invoicing:settings.manage",
  ],
}

const contextProvider = (context: RequestContext): RequestContextProvider => ({
  current: Effect.succeed(context),
})

const fixedClock: Clock = { now: Effect.succeed(new Date("2026-09-01T10:00:00.000Z")) }
const each = { code: "C62", name: "unitate" } as const
let idempotencyCounter = 0
const idempotent = <Input>(request: Input, key = `test-${String(++idempotencyCounter)}`) => ({
  request,
  idempotency: { key, fingerprint: `sha256:${"0".repeat(64)}` },
})
const vatConfigurations = [{
  code: "RO_STANDARD",

  rate: "21.00",
  effectiveFrom: "2025-08-01",
}]

const sequentialIds = (): IdGenerator => {
  let next = 0
  return { next: Effect.sync(() => `id-${String(++next)}`) }
}

const expectConflict = async <Value>(effect: Effect.Effect<Value, InvoicingFailure>, code: string): Promise<void> => {
  const failure = await Effect.runPromise(Effect.flip(effect))
  assert.equal(failure instanceof DomainConflict && failure.code === code, true)
}

const emptyState = (): MemoryState => ({
  issuers: new Map(),
  documentSeries: new Map(),
  customers: new Map(),
  productPresets: new Map(),
  drafts: new Map(),
  issued: new Map(),
  proformas: new Map(),
  conversions: new Map(),
  invoiceConversions: new Map(),
  sequences: new Map(),
  corrections: new Map(),
  idempotency: new Map(),
})

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
  assert.deepEqual(await Effect.runPromise(service.listIssuedInvoices()), [issued])

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
  assert.deepEqual(await Effect.runPromise(service.listCustomers()), [])
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

void test("updates tenant customers and manages hard-deleted product presets", async () => {
  const state = emptyState()
  const generator = sequentialIds()
  const service = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: fixedClock, ids: generator, store: memoryStore(state), cubeIdentity: "invoicing",
  })
  const other = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-2" } }),
    clock: fixedClock, ids: generator, store: memoryStore(state), cubeIdentity: "invoicing",
  })
  const customer = await Effect.runPromise(service.createCustomer({
    partyType: "individual", name: "Ion", fiscalIdentifier: "",
    address: { countryCode: "RO", city: "Iași", street: "Strada 1" }, defaultPaymentTermDays: 0,
  }))
  assert.equal(customer.defaultPaymentTermDays, 0)
  const updated = await Effect.runPromise(service.updateCustomer({
    id: customer.id, partyType: "individual", name: "Ion Actualizat", fiscalIdentifier: "",
    address: { countryCode: "RO", city: "Cluj", street: "Strada 2" }, defaultPaymentTermDays: 30,
  }))
  assert.equal(updated.defaultPaymentTermDays, 30)
  assert.equal((await Effect.runPromise(service.getCustomer(customer.id))).name, "Ion Actualizat")
  assert.equal(await Effect.runPromise(Effect.flip(other.updateCustomer({ ...updated, name: "Intrus" }))) instanceof ResourceNotFound, true)
  assert.equal(await Effect.runPromise(Effect.flip(service.updateCustomer({ ...updated, defaultPaymentTermDays: -1 }))) instanceof ValidationFailure, true)
  await Effect.runPromise(service.deleteCustomer(customer.id))
  assert.equal(await Effect.runPromise(Effect.flip(service.updateCustomer(updated))) instanceof ResourceNotFound, true)

  const preset = await Effect.runPromise(service.createProductPreset({ description: "  Consultanță  ", unitPrice: "12.5", unitOfMeasure: each }))
  assert.deepEqual(preset, { id: "id-2", organizationId: "org-1", description: "Consultanță", unitPrice: "12.50", unitOfMeasure: each })
  assert.deepEqual(await Effect.runPromise(service.listProductPresets()), [preset])
  assert.deepEqual(await Effect.runPromise(other.listProductPresets()), [])
  assert.equal(await Effect.runPromise(Effect.flip(other.updateProductPreset({ id: preset.id, description: "X", unitPrice: "1", unitOfMeasure: each }))) instanceof ResourceNotFound, true)
  const changed = await Effect.runPromise(service.updateProductPreset({ id: preset.id, description: "Audit", unitPrice: "20", unitOfMeasure: each }))
  assert.equal(changed.unitPrice, "20.00")
  assert.equal(await Effect.runPromise(Effect.flip(service.createProductPreset({ description: " ", unitPrice: "1", unitOfMeasure: each }))) instanceof ValidationFailure, true)
  assert.equal(await Effect.runPromise(Effect.flip(service.createProductPreset({ description: "Invalid", unitPrice: "1.001", unitOfMeasure: each }))) instanceof ValidationFailure, true)
  await Effect.runPromise(service.deleteProductPreset(preset.id))
  assert.deepEqual(await Effect.runPromise(service.listProductPresets()), [])
  assert.equal(await Effect.runPromise(Effect.flip(service.deleteProductPreset(preset.id))) instanceof ResourceNotFound, true)
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
  assert.equal((await Effect.runPromise(service.listProformas()))[0]?.convertedDraftId, null)
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
  assert.equal((await Effect.runPromise(service.listProformas()))[0]?.convertedDraftId, null)

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

void test("refuses missing permissions and cross-organization reads", async () => {
  const state = emptyState()
  const denied = createInvoicingService({
    context: contextProvider({
      identity: { ...identity, permissions: [] },
      organization: { id: "org-1" },
    }),
    clock: fixedClock,
    ids: sequentialIds(),
    store: memoryStore(state),
    cubeIdentity: "invoicing",
  })

  const failure = await Effect.runPromise(Effect.flip(denied.configureIssuer({
    name: "Exemplu SRL",
    fiscalIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    vatConfigurations,
  })))
  assert.equal(failure instanceof PermissionDenied, true)
  assert.equal(await Effect.runPromise(Effect.flip(denied.listProductPresets())) instanceof PermissionDenied, true)
  assert.equal(await Effect.runPromise(Effect.flip(denied.createProductPreset({
    description: "Servicii", unitPrice: "1.00", unitOfMeasure: each,
  }))) instanceof PermissionDenied, true)
  assert.equal(await Effect.runPromise(Effect.flip(denied.updateCustomer({
    id: "missing", partyType: "individual", name: "Ion", fiscalIdentifier: "",
    address: { countryCode: "RO", city: "Iași", street: "Strada 1" },
  }))) instanceof PermissionDenied, true)
})

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
