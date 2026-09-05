import assert from "node:assert/strict"

import { Effect } from "effect"

import {
  DomainConflict,
  type Clock,
  type IdGenerator,
  type InvoicingFailure,
  type RequestContext,
  type RequestContextProvider,
  type TransactionalStore,
} from "../contracts/index.ts"
import type { IdempotencyRecord, ProformaConversion } from "../domain/invoice.ts"
import type { DraftInvoice, InvoicingTransaction, IssuedInvoice, Proforma } from "./invoicing.ts"
import type { DocumentCursor, DraftCursor, NameCursor, PageQuery } from "./ports.ts"

const sameSource = (value: { readonly source?: { readonly app: string; readonly kind: string; readonly id: string } }, source: { readonly app: string; readonly kind: string; readonly id: string } | undefined): boolean =>
  source === undefined || (value.source?.app === source.app && value.source.kind === source.kind && value.source.id === source.id)
const paged = <Item, Key>(sorted: ReadonlyArray<Item>, page: PageQuery<Key>, isAfter: (item: Item, after: Key) => boolean): ReadonlyArray<Item> => {
  const after = page.after
  const rest = after === undefined ? sorted : sorted.filter((item) => isAfter(item, after))
  return rest.slice(0, page.limit + 1)
}
const afterDocument = (item: { readonly issueDate: string; readonly number: number; readonly id: string }, after: DocumentCursor): boolean =>
  item.issueDate < after.issueDate || (item.issueDate === after.issueDate && item.number < after.number)
  || (item.issueDate === after.issueDate && item.number === after.number && item.id > after.id)
const afterDraft = (item: { readonly issueDate: string; readonly id: string }, after: DraftCursor): boolean =>
  item.issueDate < after.issueDate || (item.issueDate === after.issueDate && item.id > after.id)
const afterName = (name: string, id: string, after: NameCursor): boolean =>
  name.localeCompare(after.name) > 0 || (name.localeCompare(after.name) === 0 && id > after.id)

// In-memory transactional store and fixtures shared by the component tests.
export interface MemoryState {
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

export const memoryStore = (state: MemoryState): TransactionalStore<InvoicingTransaction> => ({
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
      listCustomers: (organizationId, page) => Effect.succeed(paged(
        [...working.customers.values()]
          .filter((customer) => customer.organizationId === organizationId && customer.deletedAt === undefined)
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
        page, (customer, after) => afterName(customer.name, customer.id, after),
      )),
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
      listProductPresets: (organizationId, page) => Effect.succeed(paged([...working.productPresets.values()]
        .filter((preset) => preset.organizationId === organizationId)
        .sort((a, b) => a.description.localeCompare(b.description) || a.id.localeCompare(b.id)),
      page, (preset, after) => afterName(preset.description, preset.id, after))),
      deleteProductPreset: (organizationId, id) => Effect.sync(() => {
        if (working.productPresets.get(id)?.organizationId === organizationId) working.productPresets.delete(id)
      }),
      saveDraft: (draft) => Effect.sync(() => { working.drafts.set(draft.id, draft) }),
      findDraft: (organizationId, id) => Effect.succeed(
        working.drafts.get(id)?.organizationId === organizationId ? working.drafts.get(id) : undefined,
      ),
      listDrafts: (organizationId, page, source) => Effect.succeed(paged([...working.drafts.values()]
        .filter((draft) => draft.organizationId === organizationId && draft.status === "draft" && sameSource(draft, source))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || a.id.localeCompare(b.id)), page, afterDraft)),
      deleteDraft: (organizationId, id) => Effect.sync(() => {
        const draft = working.drafts.get(id)
        if (draft === undefined || draft.organizationId !== organizationId || draft.status !== "draft") {
          throw new DomainConflict({ code: "draft_not_editable", message: "Draft cannot be deleted" })
        }
        working.drafts.delete(id)
      }),
      findLatestIssueDate: (organizationId, fiscalYear, documentType, series) => Effect.sync(() => {
        const dates = documentType === "proforma"
          ? [...working.proformas.values()].filter((p) => p.organizationId === organizationId && p.series === series).map((p) => p.issueDate)
          : [
            ...[...working.issued.values()].filter((i) => i.organizationId === organizationId && i.series === series).map((i) => i.issueDate),
            ...[...working.corrections.values()].filter((c) => c.organizationId === organizationId && c.series === series).map((c) => c.issueDate),
          ]
        const inYear = dates.filter((date) => Number(date.slice(0, 4)) === fiscalYear).sort()
        return inYear.at(-1)
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
      listIssuedInvoices: (organizationId, page, source) => Effect.succeed(paged(
        [...working.issued.values()]
          .filter((invoice) => invoice.organizationId === organizationId && sameSource(invoice, source))
          .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number - a.number || a.id.localeCompare(b.id)),
        page, afterDocument,
      )),
      saveProforma: (proforma) => Effect.sync(() => { working.proformas.set(proforma.id, proforma) }),
      findProforma: (organizationId, id) => Effect.sync(() => {
        const value = working.proformas.get(id)
        const conversion = working.conversions.get(id)
        return value?.organizationId === organizationId
          ? { ...value, convertedDraftId: conversion?.resultingDraftId ?? null,
            convertedInvoiceId: working.invoiceConversions.get(id)?.resultingInvoiceId ?? null }
          : undefined
      }),
      listProformas: (organizationId, page, source) => Effect.succeed(paged([...working.proformas.values()]
        .filter((value) => value.organizationId === organizationId && sameSource(value, source))
        .map((value) => ({ ...value, convertedDraftId: working.conversions.get(value.id)?.resultingDraftId ?? null,
          convertedInvoiceId: working.invoiceConversions.get(value.id)?.resultingInvoiceId ?? null }))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number - a.number || a.id.localeCompare(b.id)), page, afterDocument)),
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

export const identity = {
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

export const contextProvider = (context: RequestContext): RequestContextProvider => ({
  current: Effect.succeed(context),
})

export const fixedClock: Clock = { now: Effect.succeed(new Date("2026-09-01T10:00:00.000Z")) }
export const each = { code: "C62", name: "unitate" } as const
let idempotencyCounter = 0
export const idempotent = <Input>(request: Input, key = `test-${String(++idempotencyCounter)}`) => ({
  request,
  idempotency: { key, fingerprint: `sha256:${"0".repeat(64)}` },
})
export const vatConfigurations = [{
  code: "RO_STANDARD",

  rate: "21.00",
  effectiveFrom: "2025-08-01",
}]

export const sequentialIds = (): IdGenerator => {
  let next = 0
  return { next: Effect.sync(() => `id-${String(++next)}`) }
}

export const expectConflict = async <Value>(effect: Effect.Effect<Value, InvoicingFailure>, code: string): Promise<void> => {
  const failure = await Effect.runPromise(Effect.flip(effect))
  assert.equal(failure instanceof DomainConflict && failure.code === code, true)
}

export const emptyState = (): MemoryState => ({
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
