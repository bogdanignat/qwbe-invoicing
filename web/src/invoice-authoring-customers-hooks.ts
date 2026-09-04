import type { Dispatch, SetStateAction } from "react"

import { editDueDate, selectBuyerMode, selectIssueDate, selectedSavedCustomer, selectSavedCustomer, type BuyerMode, type InvoiceAuthoringForm } from "./invoice-authoring-state.ts"
import type { Customer, Issuer } from "./models.ts"

interface AuthoringCustomerInput {
  readonly customers: ReadonlyArray<Customer>
  readonly issuer: Issuer
  readonly deriveDueDate: boolean
  readonly setForm: Dispatch<SetStateAction<InvoiceAuthoringForm>>
}

export const useInvoiceAuthoringCustomers = (input: AuthoringCustomerInput) => {
  const chooseCustomer = (customerId: string): void => {
    const customer = input.customers.find((item) => item.id === customerId)
    input.setForm((form) => selectSavedCustomer(form, customerId, customer, input.issuer, input.deriveDueDate))
  }
  const chooseIssueDate = (issueDate: string): void => {
    input.setForm((form) => selectIssueDate(
      form,
      issueDate,
      selectedSavedCustomer(form, input.customers),
      input.issuer,
      input.deriveDueDate,
    ))
  }
  const chooseDueDate = (dueDate: string): void => {
    input.setForm((form) => editDueDate(form, dueDate))
  }
  const chooseBuyerMode = (buyerMode: BuyerMode): void => {
    input.setForm((form) => selectBuyerMode(form, buyerMode, input.customers, input.issuer, input.deriveDueDate))
  }
  return { chooseCustomer, chooseIssueDate, chooseDueDate, chooseBuyerMode }
}
