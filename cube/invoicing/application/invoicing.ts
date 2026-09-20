import { Effect } from "effect"

import { createCatalogOperations, type CatalogOperations, type CatalogTransaction } from "../catalog/index.ts"
import { PermissionDenied, type InvoicingFailure } from "../contracts/failures.ts"
import type { BrandingNormalizer, Clock, IdGenerator, RequestContext, RequestContextProvider, TransactionalStore } from "../contracts/host.ts"
import { invoicingPermissions } from "../contracts/permissions.ts"
import { createCorrectionOperations, type CorrectionOperations } from "../corrections/index.ts"
import { createCustomerOperations, type CustomerOperations, type CustomersTransaction } from "../customers/index.ts"
import { createDraftOperations, type DraftOperations } from "../drafts/index.ts"
import { createIssuanceOperations, type IssuanceOperations } from "../issuance/index.ts"
import { createRegistryOperations, type RegistryOperations } from "../registry/index.ts"
import type { InvoicingTransaction } from "./ports.ts"

export interface InvoicingDependencies {
  readonly context: RequestContextProvider
  readonly clock: Clock
  readonly ids: IdGenerator
  // One store whose transaction carries the kernel port and every child port, so an
  // operation that spans customers and drafts stays in one database transaction.
  readonly store: TransactionalStore<InvoicingTransaction & CustomersTransaction & CatalogTransaction>
  readonly branding: BrandingNormalizer
  readonly cubeIdentity: string
}

export interface InvoicingService extends RegistryOperations, CustomerOperations, CatalogOperations, DraftOperations, IssuanceOperations, CorrectionOperations {}

// Composition root: every component receives the same dependencies, permission names and
// authorization check, and the service is the union of their operations.
export const createInvoicingService = (dependencies: InvoicingDependencies): InvoicingService => {
  const permissions = invoicingPermissions(dependencies.cubeIdentity)
  const authorized = (permission: string): Effect.Effect<RequestContext, InvoicingFailure> =>
    Effect.flatMap(dependencies.context.current, (context) =>
      context.identity.permissions.includes(permission)
        ? Effect.succeed(context)
        : Effect.fail(new PermissionDenied({ permission })))

  return {
    ...createRegistryOperations(dependencies, permissions, authorized),
    ...createCustomerOperations(dependencies, permissions, authorized),
    ...createCatalogOperations(dependencies, permissions, authorized),
    ...createDraftOperations(dependencies, permissions, authorized),
    ...createIssuanceOperations(dependencies, permissions, authorized),
    ...createCorrectionOperations(dependencies, permissions, authorized),
  }
}

export type { DraftInvoice, IssuedInvoice } from "../domain/invoice.ts"
export type { Proforma } from "../issuance/index.ts"
export type { InvoicingTransaction } from "./ports.ts"
