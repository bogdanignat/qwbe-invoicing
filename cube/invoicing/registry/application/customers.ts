import { Effect } from "effect"

import { checked, copyBuyer, missing, type Authorize, type OperationDependencies } from "../../application/support.ts"
import { DomainConflict, type InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { CreateCustomerInput, Customer, UpdateCustomerInput } from "../../domain/invoice.ts"
import { validateCustomer } from "../domain/validation.ts"

export interface CustomerOperations {
  readonly createCustomer: (input: CreateCustomerInput) => Effect.Effect<Customer, InvoicingFailure>
  readonly updateCustomer: (input: UpdateCustomerInput) => Effect.Effect<Customer, InvoicingFailure>
  readonly getCustomer: (id: string) => Effect.Effect<Customer, InvoicingFailure>
  readonly listCustomers: () => Effect.Effect<ReadonlyArray<Customer>, InvoicingFailure>
  readonly deleteCustomer: (id: string) => Effect.Effect<void, InvoicingFailure>
}

export const createCustomerOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): CustomerOperations => {
  const createCustomer = (input: CreateCustomerInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageCustomers)
    const customer: Customer = { ...copyBuyer(input), id: yield* dependencies.ids.next, organizationId: context.organization.id,
      ...(input.defaultPaymentTermDays === undefined ? {} : { defaultPaymentTermDays: input.defaultPaymentTermDays }) }
    yield* checked(() => { validateCustomer(customer) })
    yield* dependencies.store.transaction((transaction) => transaction.saveCustomer(customer))
    return structuredClone(customer)
  })
  const updateCustomer = (input: UpdateCustomerInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageCustomers)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const existing = yield* transaction.findCustomer(context.organization.id, input.id)
      if (existing === undefined || existing.deletedAt !== undefined) return yield* Effect.fail(missing("customer", input.id))
      const customer: Customer = { ...copyBuyer(input), id: input.id, organizationId: context.organization.id,
        ...(input.defaultPaymentTermDays === undefined ? {} : { defaultPaymentTermDays: input.defaultPaymentTermDays }) }
      yield* checked(() => { validateCustomer(customer) })
      yield* transaction.saveCustomer(customer)
      return structuredClone(customer)
    }))
  })
  const getCustomer = (id: string) => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    const customer = yield* dependencies.store.transaction((transaction) => transaction.findCustomer(context.organization.id, id))
    return customer === undefined || customer.deletedAt !== undefined
      ? yield* Effect.fail(missing("customer", id))
      : structuredClone(customer)
  })
  const listCustomers = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    return structuredClone(yield* dependencies.store.transaction((transaction) => transaction.listCustomers(context.organization.id)))
  })
  const deleteCustomer = (id: string) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageCustomers)
    const deletedAt = yield* dependencies.clock.now
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const customer = yield* transaction.findCustomer(context.organization.id, id)
      if (customer === undefined) return yield* Effect.fail(missing("customer", id))
      if (customer.deletedAt !== undefined) return
      if (yield* transaction.hasOpenDraftsForCustomer(context.organization.id, id)) {
        return yield* Effect.fail(new DomainConflict({
          code: "customer_has_open_drafts",
          message: "Cannot delete a customer used by an open invoice draft",
        }))
      }
      yield* transaction.softDeleteCustomer(context.organization.id, id, deletedAt.toISOString())
    }))
  })
  return { createCustomer, updateCustomer, getCustomer, listCustomers, deleteCustomer }
}
