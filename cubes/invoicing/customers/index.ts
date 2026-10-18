const identity = "customers"

export const cube = {
  manifest: {
    name: identity,
    parent: "invoicing",
    tables: ["customers"],
    requiresAuth: true,
    permissions: [],
  },
  create: () => ({ handlers: {} }),
}

export { createCustomerOperations } from "./application/customers.ts"
export type { CustomerOperations } from "./application/customers.ts"
export type { CustomersTransaction } from "./application/ports.ts"
export { validateCustomer } from "./domain/customer.ts"
export type { CreateCustomerInput, Customer, CustomerInput, UpdateCustomerInput } from "./domain/customer.ts"
export { customersMigrations } from "./contracts/migrations.ts"
export type { CustomersMigration } from "./contracts/migrations.ts"
