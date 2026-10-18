import { ValidationFailure } from "../../contracts/failures.ts"
import type { BuyerSnapshot } from "../../domain/invoice.ts"
import { maximumPaymentTermDays } from "../../domain/validation.ts"
import { validateBuyer } from "../../parties/index.ts"

export interface Customer extends BuyerSnapshot {
  readonly id: string
  readonly organizationId: string
  readonly defaultPaymentTermDays?: number
  readonly deletedAt?: string
}

export type CustomerInput = BuyerSnapshot & { readonly defaultPaymentTermDays?: number }
export type CreateCustomerInput = CustomerInput
export type UpdateCustomerInput = CustomerInput & { readonly id: string }

export const validateCustomer = (customer: CustomerInput): void => {
  validateBuyer(customer)
  if (customer.defaultPaymentTermDays !== undefined
    && (!Number.isInteger(customer.defaultPaymentTermDays) || customer.defaultPaymentTermDays < 0
      || customer.defaultPaymentTermDays > maximumPaymentTermDays)) {
    throw new ValidationFailure({ issues: [`defaultPaymentTermDays must be an integer between 0 and ${String(maximumPaymentTermDays)}`] })
  }
}
