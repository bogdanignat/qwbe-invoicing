import { HttpApiGroup } from "@effect/platform"

import { invoicingPermissions } from "./contracts/permissions.ts"

const identity = "invoicing"
const permissions = invoicingPermissions(identity)
const group = HttpApiGroup.make(identity)
const declaredPermissions: ReadonlyArray<string> = [
  permissions.read,
  permissions.manageCustomers,
  permissions.draftInvoices,
  permissions.issueInvoices,
  permissions.voidInvoices,
  permissions.recordPayments,
  permissions.manageSettings,
]

export const cube = {
  manifest: {
    name: identity,
    tables: [],
    requiresAuth: true,
    permissions: declaredPermissions.map((name) => ({ name, roles: ["admin"] })),
  },
  create: () => ({
    group,
    handlers: {},
  }),
}

export * from "./contracts/index.ts"
