import { Effect } from "effect"

import { createCatalogOperations, type CatalogOperations, type CatalogTransaction } from "../catalog/index.ts"
import { PermissionDenied, type InvoicingFailure } from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, RequestContextProvider, TransactionalStore } from "../contracts/host.ts"
import { invoicingPermissions } from "../contracts/permissions.ts"
import { createCorrectionOperations, createInvoiceRegisterOperations, type CorrectionOperations, type CorrectionsTransaction, type InvoiceRegisterOperations } from "../corrections/index.ts"
import { createCustomerOperations, type CustomerOperations, type CustomersTransaction } from "../customers/index.ts"
import { createDraftOperations, type DraftOperations } from "../drafts/index.ts"
import { createIssuanceOperations, type IssuanceOperations, type ProformaTransaction } from "../issuance/index.ts"
import { createIssuerOperations, type BrandingNormalizer, type IssuerOperations, type IssuerTransaction } from "../issuer/index.ts"
import type { InvoicingTransaction } from "./ports.ts"

export interface InvoicingDependencies {
  readonly context: RequestContextProvider
  readonly clock: Clock
  readonly ids: IdGenerator
  // One store whose transaction carries the kernel port and every child port, so an
  // operation that spans customers and drafts stays in one database transaction.
  readonly store: TransactionalStore<InvoicingTransaction & CustomersTransaction & CatalogTransaction & IssuerTransaction & ProformaTransaction & CorrectionsTransaction>
  readonly branding: BrandingNormalizer
  readonly cubeIdentity: string
}

export interface InvoicingService extends IssuerOperations, CustomerOperations, CatalogOperations, DraftOperations, IssuanceOperations, CorrectionOperations, InvoiceRegisterOperations {}

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
    ...createIssuerOperations(dependencies, permissions, authorized),
    ...createCustomerOperations(dependencies, permissions, authorized),
    ...createCatalogOperations(dependencies, permissions, authorized),
    ...createDraftOperations(dependencies, permissions, authorized),
    ...createIssuanceOperations(dependencies, permissions, authorized),
    ...createCorrectionOperations(dependencies, permissions, authorized),
    ...createInvoiceRegisterOperations(dependencies, permissions, authorized),
  }
}

export type { DraftInvoice, IssuedInvoice } from "../domain/invoice.ts"
export type { Proforma } from "../issuance/index.ts"
export type { InvoicingTransaction } from "./ports.ts"
