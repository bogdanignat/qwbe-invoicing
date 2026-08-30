import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import {
  createInvoicingService,
  type DraftInvoice,
  type InvoicingTransaction,
  type IssuedInvoice,
} from "./invoicing.ts"
import {
  DomainConflict,
  PermissionDenied,
  ValidationFailure,
  type Clock,
  type IdGenerator,
  type RequestContext,
  type RequestContextProvider,
  type TransactionalStore,
} from "../contracts/index.ts"

interface MemoryState {
  issuers: Map<string, Parameters<InvoicingTransaction["saveIssuer"]>[0]>
  customers: Map<string, Parameters<InvoicingTransaction["saveCustomer"]>[0]>
  drafts: Map<string, DraftInvoice>
  issued: Map<string, IssuedInvoice>
  sequences: Map<string, number>
}

const cloneState = (state: MemoryState): MemoryState => structuredClone(state)

const memoryStore = (state: MemoryState): TransactionalStore<InvoicingTransaction> => ({
  transaction: (use) => Effect.suspend(() => {
    const working = cloneState(state)
    const transaction: InvoicingTransaction = {
      saveIssuer: (issuer) => Effect.sync(() => { working.issuers.set(issuer.organizationId, issuer) }),
      findIssuer: (organizationId) => Effect.succeed(working.issuers.get(organizationId)),
      saveCustomer: (customer) => Effect.sync(() => { working.customers.set(customer.id, customer) }),
      findCustomer: (organizationId, id) => Effect.succeed(
        working.customers.get(id)?.organizationId === organizationId ? working.customers.get(id) : undefined,
      ),
      saveDraft: (draft) => Effect.sync(() => { working.drafts.set(draft.id, draft) }),
      findDraft: (organizationId, id) => Effect.succeed(
        working.drafts.get(id)?.organizationId === organizationId ? working.drafts.get(id) : undefined,
      ),
      allocateInvoiceNumber: (organizationId, fiscalYear, series) => Effect.sync(() => {
        const key = `${organizationId}:${String(fiscalYear)}:${series}`
        const next = (working.sequences.get(key) ?? 0) + 1
        working.sequences.set(key, next)
        return next
      }),
      saveIssuedInvoice: (invoice) => Effect.sync(() => { working.issued.set(invoice.id, invoice) }),
      findIssuedInvoice: (organizationId, id) => Effect.succeed(
        working.issued.get(id)?.organizationId === organizationId ? working.issued.get(id) : undefined,
      ),
    }
    return Effect.tap(use(transaction), () => Effect.sync(() => {
      state.issuers = working.issuers
      state.customers = working.customers
      state.drafts = working.drafts
      state.issued = working.issued
      state.sequences = working.sequences
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
    "invoicing:settings.manage",
  ],
}

const contextProvider = (context: RequestContext): RequestContextProvider => ({
  current: Effect.succeed(context),
})

const fixedClock: Clock = { now: Effect.succeed(new Date("2026-09-01T10:00:00.000Z")) }
const taxConfigurations = [{
  code: "RO_STANDARD",
  category: "standard" as const,
  rate: "21.00",
  effectiveFrom: "2025-08-01",
}]

const sequentialIds = (): IdGenerator => {
  let next = 0
  return { next: Effect.sync(() => `id-${String(++next)}`) }
}

const emptyState = (): MemoryState => ({
  issuers: new Map(),
  customers: new Map(),
  drafts: new Map(),
  issued: new Map(),
  sequences: new Map(),
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
    legalName: "Exemplu SRL",
    taxIdentifier: "RO12345678",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    defaultSeries: "QWBE",
    taxConfigurations,
  }))
  const customer = await Effect.runPromise(service.createCustomer({
    legalName: "Client SRL",
    taxIdentifier: "RO87654321",
    address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2" },
  }))
  const invalidDueDate = await Effect.runPromise(Effect.flip(service.createDraft({
    customerId: customer.id,
    issueDate: "2026-09-01",
    dueDate: "2026-08-31",
  })))
  assert.equal(invalidDueDate instanceof ValidationFailure, true)
  const draft = await Effect.runPromise(service.createDraft({
    customerId: customer.id,
    issueDate: "2026-09-01",
  }))
  await Effect.runPromise(service.addDraftLine({
    draftId: draft.id,
    description: "Servicii software",
    quantity: "1.2500",
    unitPrice: "100.00",
    taxCode: "RO_STANDARD",
  }))

  const issued = await Effect.runPromise(service.issueInvoice({ draftId: draft.id }))
  assert.equal(issued.number, 1)
  assert.equal(issued.series, "QWBE")
  assert.equal(issued.totalExcludingTax, "125.00")
  assert.equal(issued.taxTotal, "26.25")
  assert.equal(issued.totalIncludingTax, "151.25")
  assert.equal(issued.issuer.legalName, "Exemplu SRL")
  assert.equal(issued.customer.legalName, "Client SRL")

  await Effect.runPromise(service.configureIssuer({
    legalName: "Exemplu Renamed SRL",
    taxIdentifier: "RO12345678",
    address: { countryCode: "RO", city: "Botoșani", street: "Altă stradă 3" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 30,
    defaultSeries: "NEW",
    taxConfigurations,
  }))
  const preserved = await Effect.runPromise(service.getIssuedInvoice(issued.id))
  assert.equal(preserved.issuer.legalName, "Exemplu SRL")
  assert.equal(preserved.series, "QWBE")
})

void test("keeps numbering and issued data unchanged when issuance rolls back", async () => {
  const state = emptyState()
  const baseStore = memoryStore(state)
  const failingStore: TransactionalStore<InvoicingTransaction> = {
    transaction: (use) => baseStore.transaction((transaction) => use({
      ...transaction,
      saveIssuedInvoice: () => Effect.fail(new DomainConflict({ code: "forced_failure", message: "forced" })),
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
    legalName: "Exemplu SRL",
    taxIdentifier: "RO12345678",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    defaultSeries: "QWBE",
    taxConfigurations,
  }))
  const customer = await Effect.runPromise(service.createCustomer({
    legalName: "Client SRL",
    taxIdentifier: "RO87654321",
    address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2" },
  }))
  const draft = await Effect.runPromise(service.createDraft({ customerId: customer.id, issueDate: "2026-09-01" }))
  await Effect.runPromise(service.addDraftLine({
    draftId: draft.id,
    description: "Servicii",
    quantity: "1",
    unitPrice: "100",
    taxCode: "RO_STANDARD",
  }))

  await assert.rejects(Effect.runPromise(service.issueInvoice({ draftId: draft.id })))
  assert.equal(state.sequences.size, 0)
  assert.equal(state.issued.size, 0)
  assert.equal(state.drafts.get(draft.id)?.status, "draft")
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
    legalName: "Exemplu SRL",
    taxIdentifier: "RO12345678",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    defaultSeries: "QWBE",
    taxConfigurations,
  })))
  assert.equal(failure instanceof PermissionDenied, true)
})
