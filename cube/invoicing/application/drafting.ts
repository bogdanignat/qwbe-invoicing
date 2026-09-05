import { Effect } from "effect"

import { DomainConflict, type InvoicingFailure } from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, TransactionalStore } from "../contracts/host.ts"
import type { InvoicingPermissions } from "../contracts/permissions.ts"
import type {
  ConfigureDocumentSeriesInput,
  ConfigureIssuerInput,
  CreateCustomerInput,
  Customer,
  DocumentSeries,
  IssuerProfile,
  ProductPreset,
  ProductPresetInput,
  UpdateCustomerInput,
  UpdateProductPresetInput,
} from "../domain/invoice.ts"
import { normalizeProductPreset, validateCustomer, validateDocumentSeries, validateIssuer } from "../domain/validation.ts"
import { createDraftAuthoringOperations, type DraftAuthoringOperations } from "./draft-authoring.ts"
import type { InvoicingTransaction } from "./ports.ts"
import { checked, copyBuyer, copyParty, missing } from "./support.ts"

export interface DraftingOperations extends DraftAuthoringOperations {
  readonly configureIssuer: (input: ConfigureIssuerInput) => Effect.Effect<IssuerProfile, InvoicingFailure>
  readonly getIssuer: () => Effect.Effect<IssuerProfile, InvoicingFailure>
  readonly addDocumentSeries: (input: ConfigureDocumentSeriesInput) => Effect.Effect<DocumentSeries, InvoicingFailure>
  readonly listDocumentSeries: () => Effect.Effect<ReadonlyArray<DocumentSeries>, InvoicingFailure>
  readonly createCustomer: (input: CreateCustomerInput) => Effect.Effect<Customer, InvoicingFailure>
  readonly updateCustomer: (input: UpdateCustomerInput) => Effect.Effect<Customer, InvoicingFailure>
  readonly getCustomer: (id: string) => Effect.Effect<Customer, InvoicingFailure>
  readonly listCustomers: () => Effect.Effect<ReadonlyArray<Customer>, InvoicingFailure>
  readonly deleteCustomer: (id: string) => Effect.Effect<void, InvoicingFailure>
  readonly createProductPreset: (input: ProductPresetInput) => Effect.Effect<ProductPreset, InvoicingFailure>
  readonly listProductPresets: () => Effect.Effect<ReadonlyArray<ProductPreset>, InvoicingFailure>
  readonly updateProductPreset: (input: UpdateProductPresetInput) => Effect.Effect<ProductPreset, InvoicingFailure>
  readonly deleteProductPreset: (id: string) => Effect.Effect<void, InvoicingFailure>
}

type Dependencies = {
  readonly ids: IdGenerator
  readonly clock: Clock
  readonly store: TransactionalStore<InvoicingTransaction>
}
type Authorize = (permission: string) => Effect.Effect<RequestContext, InvoicingFailure>

export const createDraftingOperations = (
  dependencies: Dependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): DraftingOperations => {
  const authoring = createDraftAuthoringOperations(dependencies, permissions, authorize)
  const configureIssuer = (input: ConfigureIssuerInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const issuer: IssuerProfile = {
      ...copyParty(input), organizationId: context.organization.id,
      defaultCurrency: input.defaultCurrency, defaultPaymentTermDays: input.defaultPaymentTermDays,
      vatConfigurations: structuredClone(input.vatConfigurations),
    }
    yield* checked(() => { validateIssuer(issuer) })
    yield* dependencies.store.transaction((transaction) => transaction.saveIssuer(issuer))
    return structuredClone(issuer)
  })
  const getIssuer = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    const issuer = yield* dependencies.store.transaction((transaction) => transaction.findIssuer(context.organization.id))
    return issuer === undefined ? yield* Effect.fail(missing("issuer", context.organization.id)) : structuredClone(issuer)
  })
  const addDocumentSeries = (input: ConfigureDocumentSeriesInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const series: DocumentSeries = { organizationId: context.organization.id, ...input }
    yield* checked(() => { validateDocumentSeries(series) })
    yield* dependencies.store.transaction((transaction) => transaction.addDocumentSeries(series))
    return structuredClone(series)
  })
  const listDocumentSeries = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    return structuredClone(yield* dependencies.store.transaction((transaction) => transaction.listDocumentSeries(context.organization.id)))
  })
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
  const createProductPreset = (input: ProductPresetInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const normalized = yield* checked(() => normalizeProductPreset(input))
    const preset: ProductPreset = { id: yield* dependencies.ids.next, organizationId: context.organization.id, ...normalized }
    yield* dependencies.store.transaction((transaction) => transaction.saveProductPreset(preset))
    return structuredClone(preset)
  })
  const listProductPresets = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    return structuredClone(yield* dependencies.store.transaction((transaction) => transaction.listProductPresets(context.organization.id)))
  })
  const updateProductPreset = (input: UpdateProductPresetInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      if ((yield* transaction.findProductPreset(context.organization.id, input.id)) === undefined) {
        return yield* Effect.fail(missing("product_preset", input.id))
      }
      const normalized = yield* checked(() => normalizeProductPreset(input))
      const preset: ProductPreset = { id: input.id, organizationId: context.organization.id, ...normalized }
      yield* transaction.saveProductPreset(preset)
      return structuredClone(preset)
    }))
  })
  const deleteProductPreset = (id: string) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      if ((yield* transaction.findProductPreset(context.organization.id, id)) === undefined) {
        return yield* Effect.fail(missing("product_preset", id))
      }
      yield* transaction.deleteProductPreset(context.organization.id, id)
    }))
  })
  return {
    ...authoring, configureIssuer, getIssuer, addDocumentSeries, listDocumentSeries,
    createCustomer, updateCustomer, getCustomer, listCustomers, deleteCustomer,
    createProductPreset, listProductPresets, updateProductPreset, deleteProductPreset,
  }
}
