import { Effect } from "effect"

import { PermissionDenied, type InvoicingFailure } from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, RequestContextProvider, TransactionalStore } from "../contracts/host.ts"
import { invoicingPermissions } from "../contracts/permissions.ts"
import { createCorrectionOperations, type CorrectionOperations } from "../corrections/index.ts"
import { unitOfMeasures, type UnitOfMeasure } from "../domain/unit-of-measures.ts"
import { createDraftOperations, type DraftOperations } from "../drafts/index.ts"
import { createIssuanceOperations, type IssuanceOperations } from "../issuance/index.ts"
import { createRegistryOperations, type RegistryOperations } from "../registry/index.ts"
import type { InvoicingTransaction } from "./ports.ts"

export interface InvoicingDependencies {
  readonly context: RequestContextProvider
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly store: TransactionalStore<InvoicingTransaction>
  readonly cubeIdentity: string
}

export interface InvoicingService extends RegistryOperations, DraftOperations, IssuanceOperations, CorrectionOperations {
  readonly listUnitOfMeasures: () => Effect.Effect<ReadonlyArray<UnitOfMeasure>, InvoicingFailure>
}

// Composition root: every component receives the same dependencies, permission names and
// authorization check, and the service is the union of their operations.
export const createInvoicingService = (dependencies: InvoicingDependencies): InvoicingService => {
  const permissions = invoicingPermissions(dependencies.cubeIdentity)
  const authorized = (permission: string): Effect.Effect<RequestContext, InvoicingFailure> =>
    Effect.flatMap(dependencies.context.current, (context) =>
      context.identity.permissions.includes(permission)
        ? Effect.succeed(context)
        : Effect.fail(new PermissionDenied({ permission })))

  const listUnitOfMeasures = () => Effect.gen(function*() {
    yield* authorized(permissions.read)
    return unitOfMeasures.map((unit) => ({ ...unit }))
  })

  return {
    ...createRegistryOperations(dependencies, permissions, authorized),
    ...createDraftOperations(dependencies, permissions, authorized),
    ...createIssuanceOperations(dependencies, permissions, authorized),
    ...createCorrectionOperations(dependencies, permissions, authorized),
    listUnitOfMeasures,
  }
}

export type { DraftInvoice, IssuedInvoice, Proforma } from "../domain/invoice.ts"
export type { InvoicingTransaction } from "./ports.ts"
