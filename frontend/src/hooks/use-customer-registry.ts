"use client"

import { useAuthoringPagedList } from "./use-authoring-paged-list.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { useRegistryEditor, type RegistryEditorIssue } from "./use-registry-editor.ts"
import { useRegistryWrites } from "./use-registry-writes.ts"
import {
  chooseCustomerCounty, customerFormOf, customerSectorRequired, newCustomerForm,
  normalizeCustomerIdentifier, switchCustomerPartyType, type CustomerForm,
} from "../lib/customer-form.ts"
import { customerPayload, type CustomerField } from "../lib/customer-payload.ts"
import { customerDeleteConfirm, customerNotice } from "../lib/registry-feedback.ts"
import { registryLoad, registryReload, type RegistryLoad } from "../lib/registry-load.ts"
import type { PartyType } from "../lib/document-authoring-form-model.ts"
import type { Customer } from "../lib/draft-models.ts"

/**
 * The customer registry screen: the saved parties, the editor beside them, and
 * the three writes.
 *
 * The transitions that are not a plain field write — switching party type,
 * choosing a county — go through the pure functions in `customer-form.ts`, so
 * the screen never has to remember that a sector belongs to Bucharest alone or
 * that a CNP is digits only. `sectorRequired` is derived here rather than in the
 * component for the same reason.
 */
export interface CustomerRegistryModel {
  readonly load: RegistryLoad
  /** Absent when the failure is settled: a `403` or a `404` is not repeated on request. */
  readonly retry: (() => void) | undefined
  readonly customers: ReadonlyArray<Customer>
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  /** The record open in the editor; `id` absent means a customer being created. */
  readonly editing: { readonly id: string | undefined } | undefined
  readonly form: CustomerForm | undefined
  readonly sectorRequired: boolean
  readonly issue: RegistryEditorIssue<CustomerField> | undefined
  readonly pending: boolean
  readonly error: unknown
  readonly notice: string | undefined
  readonly startCreate: () => void
  readonly startEdit: (customer: Customer) => void
  readonly close: () => void
  readonly change: (patch: Partial<CustomerForm>) => void
  readonly changePartyType: (partyType: PartyType) => void
  readonly changeIdentifier: (value: string) => void
  readonly changeCounty: (county: string) => void
  readonly submit: () => void
  readonly remove: (customer: Customer) => void
}

export const useCustomerRegistry = (): CustomerRegistryModel => {
  const clients = useInvoicingClients()
  const list = useAuthoringPagedList<Customer>(
    ["customers"], (page, signal) => clients.reference.listCustomers(page, signal),
  )
  const writes = useRegistryWrites(["customers"], customerNotice)
  const editor = useRegistryEditor<CustomerForm, CustomerField>()
  const editing = editor.editing
  const load = registryLoad([["customers", { data: list.items, isPending: list.isPending, error: list.error }]])
  const submit = (): void => {
    if (editing === undefined) return
    const validation = customerPayload(editing.form)
    if (validation.kind === "issue") {
      editor.refuse({ field: validation.field, message: validation.message })
      return
    }
    const { id } = editing
    const { payload } = validation
    writes.submit({
      write: id === undefined ? "created" : "updated",
      run: (csrfToken) => id === undefined
        ? clients.registry.createCustomer(csrfToken, payload)
        : clients.registry.updateCustomer(csrfToken, id, payload),
      onDone: editor.close,
    })
  }
  return {
    load,
    retry: registryReload(load, { customers: () => { list.refetch() } }),
    customers: list.items ?? [],
    hasMore: list.hasMore,
    loadingMore: list.loadingMore,
    loadMore: list.loadMore,
    editing: editing === undefined ? undefined : { id: editing.id },
    form: editing?.form,
    sectorRequired: editing !== undefined && customerSectorRequired(editing.form),
    issue: editor.issue,
    pending: writes.pending,
    error: writes.error,
    notice: writes.notice,
    startCreate: () => { writes.dismissNotice(); editor.open(undefined, newCustomerForm()) },
    startEdit: (customer) => { writes.dismissNotice(); editor.open(customer.id, customerFormOf(customer)) },
    close: editor.close,
    change: editor.change,
    changePartyType: (partyType) => { editor.apply((form) => switchCustomerPartyType(form, partyType)) },
    changeIdentifier: (value) => {
      editor.apply((form) => ({ ...form, fiscalIdentifier: normalizeCustomerIdentifier(form.partyType, value) }))
    },
    changeCounty: (county) => { editor.apply((form) => chooseCustomerCounty(form, county)) },
    submit,
    remove: (customer) => {
      if (!window.confirm(customerDeleteConfirm(customer.name))) return
      writes.submit({
        write: "deleted",
        run: (csrfToken) => clients.registry.deleteCustomer(csrfToken, customer.id),
        onDone: () => { editor.closeRecord(customer.id) },
      })
    },
  }
}
