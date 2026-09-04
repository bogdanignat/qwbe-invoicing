import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { runUiEffect } from "./api.ts"
import { formField, type FormSubmitEvent } from "./form.ts"
import { invoicingClient, type CustomerInput } from "./invoicing-client.ts"
import type { Customer, PartyType } from "./models.ts"

interface CustomerSaveRequest {
  readonly id?: string
  readonly body: CustomerInput
  readonly form: HTMLFormElement
}

const customerPayload = (form: HTMLFormElement, partyType: PartyType): CustomerInput => {
  const county = formField(form, "county")
  const postalCode = formField(form, "postalCode")
  const paymentTerm = formField(form, "defaultPaymentTermDays")
  return {
    partyType,
    legalName: formField(form, "legalName"),
    taxIdentifier: formField(form, "taxIdentifier"),
    address: {
      countryCode: "RO", city: formField(form, "city"), street: formField(form, "street"),
      ...(county === "" ? {} : { county }), ...(postalCode === "" ? {} : { postalCode }),
    },
    ...(paymentTerm === "" ? {} : { defaultPaymentTermDays: Number(paymentTerm) }),
  }
}

export const useCustomerRegistry = (notify: (message: string) => void) => {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Customer | undefined>(undefined)
  const [partyType, setPartyType] = useState<PartyType>("company")
  const customers = useQuery({ queryKey: ["customers"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listCustomers(), signal) })
  const save = useMutation({
    mutationFn: (request: CustomerSaveRequest) => request.id === undefined
      ? runUiEffect(invoicingClient.createCustomer(request.body))
      : runUiEffect(invoicingClient.updateCustomer(request.id, request.body)),
    onSuccess: async (_customer, request) => {
      request.form.reset()
      setEditing(undefined)
      setPartyType("company")
      await queryClient.invalidateQueries({ queryKey: ["customers"] })
      notify(request.id === undefined ? "Clientul a fost creat." : "Clientul a fost actualizat.")
    },
  })
  const removal = useMutation({
    mutationFn: (id: string) => runUiEffect(invoicingClient.deleteCustomer(id)),
    onSuccess: async (_result, id) => {
      if (editing?.id === id) { setEditing(undefined); setPartyType("company") }
      await queryClient.invalidateQueries({ queryKey: ["customers"] })
      notify("Clientul a fost șters.")
    },
  })
  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    const form = event.currentTarget
    const taxIdentifier = form.elements.namedItem("taxIdentifier")
    if (taxIdentifier instanceof HTMLInputElement) {
      const missingCompanyCui = partyType === "company" && taxIdentifier.value.trim() === ""
      taxIdentifier.setCustomValidity(missingCompanyCui ? "CUI / CIF este obligatoriu pentru persoanele juridice." : "")
      if (missingCompanyCui) { taxIdentifier.reportValidity(); taxIdentifier.setCustomValidity(""); return }
    }
    save.mutate({ ...(editing === undefined ? {} : { id: editing.id }), body: customerPayload(form, partyType), form })
  }
  const edit = (customer: Customer): void => { setEditing(customer); setPartyType(customer.partyType) }
  const cancelEdit = (): void => { setEditing(undefined); setPartyType("company") }
  const remove = (customer: Customer): void => {
    if (window.confirm(`Ștergi clientul „${customer.legalName}”? Facturile deja emise rămân neschimbate.`)) removal.mutate(customer.id)
  }
  return { customers, editing, partyType, setPartyType, submit, edit, cancelEdit, save, removal, remove }
}
