import { Effect } from "effect"

import { DomainConflict, ResourceNotFound, ValidationFailure, type InvoicingFailure } from "../contracts/failures.ts"
import type { IdGenerator, RequestContext, TransactionalStore } from "../contracts/host.ts"
import type { InvoicingPermissions } from "../contracts/permissions.ts"
import { calculateLine } from "../domain/calculation.ts"
import {
  addDays,
  type AddDraftLineInput,
  type ConfigureIssuerInput,
  type CreateCustomerInput,
  type CreateDraftInput,
  type Customer,
  type DraftInvoice,
  type IssuerProfile,
  type PartySnapshot,
} from "../domain/invoice.ts"
import { resolveTaxConfiguration, validateDate, validateIssuer, validateParty } from "../domain/validation.ts"
import type { InvoicingTransaction } from "./ports.ts"

export interface DraftingOperations {
  readonly configureIssuer: (input: ConfigureIssuerInput) => Effect.Effect<IssuerProfile, InvoicingFailure>
  readonly createCustomer: (input: CreateCustomerInput) => Effect.Effect<Customer, InvoicingFailure>
  readonly createDraft: (input: CreateDraftInput) => Effect.Effect<DraftInvoice, InvoicingFailure>
  readonly addDraftLine: (input: AddDraftLineInput) => Effect.Effect<DraftInvoice, InvoicingFailure>
}

const checked = <Value>(operation: () => Value): Effect.Effect<Value, ValidationFailure> => Effect.try({
  try: operation,
  catch: (error) => error instanceof ValidationFailure
    ? error
    : new ValidationFailure({ issues: ["invalid invoicing input"] }),
})

export const copyParty = (party: PartySnapshot): PartySnapshot => ({
  legalName: party.legalName,
  taxIdentifier: party.taxIdentifier,
  address: { ...party.address },
})

export const missing = (resource: string, id: string) => new ResourceNotFound({ resource, id })

export const createDraftingOperations = (
  dependencies: {
    readonly ids: IdGenerator
    readonly store: TransactionalStore<InvoicingTransaction>
  },
  permissions: InvoicingPermissions,
  authorized: (permission: string) => Effect.Effect<RequestContext, InvoicingFailure>,
): DraftingOperations => {
  const configureIssuer = (input: ConfigureIssuerInput) => Effect.gen(function*() {
    const context = yield* authorized(permissions.manageSettings)
    const issuer: IssuerProfile = {
      ...copyParty(input),
      organizationId: context.organization.id,
      defaultCurrency: input.defaultCurrency,
      defaultPaymentTermDays: input.defaultPaymentTermDays,
      defaultSeries: input.defaultSeries,
      taxConfigurations: structuredClone(input.taxConfigurations),
    }
    yield* checked(() => { validateIssuer(issuer) })
    yield* dependencies.store.transaction((transaction) => transaction.saveIssuer(issuer))
    return structuredClone(issuer)
  })

  const createCustomer = (input: CreateCustomerInput) => Effect.gen(function*() {
    const context = yield* authorized(permissions.manageCustomers)
    const id = yield* dependencies.ids.next
    const customer: Customer = { ...copyParty(input), id, organizationId: context.organization.id }
    yield* checked(() => { validateParty(customer) })
    yield* dependencies.store.transaction((transaction) => transaction.saveCustomer(customer))
    return structuredClone(customer)
  })

  const createDraft = (input: CreateDraftInput) => Effect.gen(function*() {
    const context = yield* authorized(permissions.draftInvoices)
    const id = yield* dependencies.ids.next
    yield* checked(() => { validateDate(input.issueDate, "issueDate") })
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const issuer = yield* transaction.findIssuer(context.organization.id)
      if (issuer === undefined) return yield* Effect.fail(missing("issuer", context.organization.id))
      const customer = yield* transaction.findCustomer(context.organization.id, input.customerId)
      if (customer === undefined) return yield* Effect.fail(missing("customer", input.customerId))
      const dueDate = input.dueDate ?? addDays(input.issueDate, issuer.defaultPaymentTermDays)
      yield* checked(() => {
        validateDate(dueDate, "dueDate")
        if (dueDate < input.issueDate) throw new ValidationFailure({ issues: ["dueDate cannot be before issueDate"] })
      })
      const draft: DraftInvoice = {
        id,
        organizationId: context.organization.id,
        customerId: customer.id,
        issueDate: input.issueDate,
        dueDate,
        currency: input.currency ?? issuer.defaultCurrency,
        status: "draft",
        lines: [],
      }
      yield* transaction.saveDraft(draft)
      return structuredClone(draft)
    }))
  })

  const addDraftLine = (input: AddDraftLineInput) => Effect.gen(function*() {
    const context = yield* authorized(permissions.draftInvoices)
    const lineId = yield* dependencies.ids.next
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const draft = yield* transaction.findDraft(context.organization.id, input.draftId)
      if (draft === undefined) return yield* Effect.fail(missing("draft", input.draftId))
      if (draft.status !== "draft") {
        return yield* Effect.fail(new DomainConflict({ code: "invoice_already_issued", message: "Issued invoices cannot be edited" }))
      }
      const issuer = yield* transaction.findIssuer(context.organization.id)
      if (issuer === undefined) return yield* Effect.fail(missing("issuer", context.organization.id))
      const tax = yield* checked(() => resolveTaxConfiguration(issuer, input.taxCode, draft.issueDate))
      const line = yield* checked(() => calculateLine({
        id: lineId,
        description: input.description,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        tax,
      }))
      const updated: DraftInvoice = { ...draft, lines: [...draft.lines, line] }
      yield* transaction.saveDraft(updated)
      return structuredClone(updated)
    }))
  })

  return { configureIssuer, createCustomer, createDraft, addDraftLine }
}
