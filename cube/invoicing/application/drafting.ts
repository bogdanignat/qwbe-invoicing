import { Effect } from "effect"
import { DomainConflict, ResourceNotFound, ValidationFailure, type InvoicingFailure } from "../contracts/failures.ts"
import type { IdGenerator, RequestContext, TransactionalStore } from "../contracts/host.ts"
import type { InvoicingPermissions } from "../contracts/permissions.ts"
import { calculateLine } from "../domain/calculation.ts"
import { addDays, type AddDraftLineInput, type ConfigureIssuerInput, type CreateCustomerInput, type CreateDraftInput, type Customer, type DraftInvoice, type IssuerProfile, type PartySnapshot } from "../domain/invoice.ts"
import { resolveTaxConfiguration, validateDate, validateIssuer, validateParty } from "../domain/validation.ts"
import type { InvoicingTransaction } from "./ports.ts"
export interface DraftingOperations {
  readonly configureIssuer: (i: ConfigureIssuerInput) => Effect.Effect<IssuerProfile, InvoicingFailure>
  readonly getIssuer: () => Effect.Effect<IssuerProfile, InvoicingFailure>
  readonly createCustomer: (i: CreateCustomerInput) => Effect.Effect<Customer, InvoicingFailure>
  readonly getCustomer: (id: string) => Effect.Effect<Customer, InvoicingFailure>
  readonly createDraft: (i: CreateDraftInput) => Effect.Effect<DraftInvoice, InvoicingFailure>
  readonly getDraft: (id: string) => Effect.Effect<DraftInvoice, InvoicingFailure>
  readonly addDraftLine: (i: AddDraftLineInput) => Effect.Effect<DraftInvoice, InvoicingFailure>
}
const checked = <V>(op: () => V): Effect.Effect<V, ValidationFailure> => Effect.try({ try: op, catch: (e) => e instanceof ValidationFailure ? e : new ValidationFailure({ issues: ["invalid invoicing input"] }) })
export const copyParty = (p: PartySnapshot): PartySnapshot => ({ legalName: p.legalName, taxIdentifier: p.taxIdentifier, address: { ...p.address } })
export const missing = (r: string, id: string) => new ResourceNotFound({ resource: r, id })
export const createDraftingOperations = (d: { readonly ids: IdGenerator; readonly store: TransactionalStore<InvoicingTransaction> }, perms: InvoicingPermissions, auth: (p: string) => Effect.Effect<RequestContext, InvoicingFailure>): DraftingOperations => {
  const configureIssuer = (input: ConfigureIssuerInput) => Effect.gen(function*() {
    const ctx = yield* auth(perms.manageSettings)
    const issuer: IssuerProfile = { ...copyParty(input), organizationId: ctx.organization.id, defaultCurrency: input.defaultCurrency, defaultPaymentTermDays: input.defaultPaymentTermDays, defaultSeries: input.defaultSeries, taxConfigurations: structuredClone(input.taxConfigurations) }
    yield* checked(() => { validateIssuer(issuer) })
    yield* d.store.transaction((tx) => tx.saveIssuer(issuer))
    return structuredClone(issuer)
  })
  const getIssuer = () => Effect.gen(function*() {
    const ctx = yield* auth(perms.read)
    return yield* d.store.transaction((tx) => Effect.gen(function*() {
      const iss = yield* tx.findIssuer(ctx.organization.id)
      if (iss === undefined) return yield* Effect.fail(missing("issuer", ctx.organization.id))
      return structuredClone(iss)
    }))
  })
  const createCustomer = (input: CreateCustomerInput) => Effect.gen(function*() {
    const ctx = yield* auth(perms.manageCustomers)
    const id = yield* d.ids.next
    const c: Customer = { ...copyParty(input), id, organizationId: ctx.organization.id }
    yield* checked(() => { validateParty(c) })
    yield* d.store.transaction((tx) => tx.saveCustomer(c))
    return structuredClone(c)
  })
  const getCustomer = (id: string) => Effect.gen(function*() {
    const ctx = yield* auth(perms.read)
    return yield* d.store.transaction((tx) => Effect.gen(function*() {
      const c = yield* tx.findCustomer(ctx.organization.id, id)
      if (c === undefined) return yield* Effect.fail(missing("customer", id))
      return structuredClone(c)
    }))
  })
  const createDraft = (input: CreateDraftInput) => Effect.gen(function*() {
    const ctx = yield* auth(perms.draftInvoices)
    const id = yield* d.ids.next
    yield* checked(() => { validateDate(input.issueDate, "issueDate") })
    return yield* d.store.transaction((tx) => Effect.gen(function*() {
      const iss = yield* tx.findIssuer(ctx.organization.id)
      if (iss === undefined) return yield* Effect.fail(missing("issuer", ctx.organization.id))
      const cust = yield* tx.findCustomer(ctx.organization.id, input.customerId)
      if (cust === undefined) return yield* Effect.fail(missing("customer", input.customerId))
      const due = input.dueDate ?? addDays(input.issueDate, iss.defaultPaymentTermDays)
      yield* checked(() => { validateDate(due, "dueDate"); if (due < input.issueDate) throw new ValidationFailure({ issues: ["dueDate cannot be before issueDate"] }) })
      const draft: DraftInvoice = { id, organizationId: ctx.organization.id, customerId: cust.id, issueDate: input.issueDate, dueDate: due, currency: input.currency ?? iss.defaultCurrency, status: "draft", lines: [] }
      yield* tx.saveDraft(draft)
      return structuredClone(draft)
    }))
  })
  const getDraft = (id: string) => Effect.gen(function*() {
    const ctx = yield* auth(perms.read)
    return yield* d.store.transaction((tx) => Effect.gen(function*() {
      const draft = yield* tx.findDraft(ctx.organization.id, id)
      if (draft === undefined) return yield* Effect.fail(missing("draft", id))
      return structuredClone(draft)
    }))
  })
  const addDraftLine = (input: AddDraftLineInput) => Effect.gen(function*() {
    const ctx = yield* auth(perms.draftInvoices)
    const lid = yield* d.ids.next
    return yield* d.store.transaction((tx) => Effect.gen(function*() {
      const draft = yield* tx.findDraft(ctx.organization.id, input.draftId)
      if (draft === undefined) return yield* Effect.fail(missing("draft", input.draftId))
      if (draft.status !== "draft") return yield* Effect.fail(new DomainConflict({ code: "invoice_already_issued", message: "Issued invoices cannot be edited" }))
      const iss = yield* tx.findIssuer(ctx.organization.id)
      if (iss === undefined) return yield* Effect.fail(missing("issuer", ctx.organization.id))
      const tax = yield* checked(() => resolveTaxConfiguration(iss, input.taxCode, draft.issueDate))
      const line = yield* checked(() => calculateLine({ id: lid, description: input.description, quantity: input.quantity, unitPrice: input.unitPrice, tax }))
      const upd: DraftInvoice = { ...draft, lines: [...draft.lines, line] }
      yield* tx.saveDraft(upd)
      return structuredClone(upd)
    }))
  })
  return { configureIssuer, getIssuer, createCustomer, getCustomer, createDraft, getDraft, addDraftLine }
}
