import type { Authorize, OperationDependencies } from "../application/support.ts"
import type { InvoicingPermissions } from "../contracts/permissions.ts"
import { createDraftLineOperations, type DraftLineOperations } from "./application/draft-lines.ts"
import { createDraftDocumentOperations, type DraftDocumentOperations } from "./application/draft-operations.ts"

const identity = "drafts"

export const cube = {
  manifest: {
    name: identity,
    parent: "invoicing",
    tables: [],
    requiresAuth: true,
    permissions: [],
  },
  create: () => ({ handlers: {} }),
}

export type DraftOperations = DraftDocumentOperations & DraftLineOperations

export const createDraftOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): DraftOperations => ({
  ...createDraftDocumentOperations(dependencies, permissions, authorize),
  ...createDraftLineOperations(dependencies, permissions, authorize),
})

export { authorDocument } from "./application/authoring.ts"
export type { DraftDocumentOperations, DraftLineOperations }
