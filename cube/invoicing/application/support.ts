import { Effect } from "effect"

import { ResourceNotFound, ValidationFailure, type InvoicingFailure } from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, TransactionalStore } from "../contracts/host.ts"
import type { BuyerSnapshot, DocumentSource, PartySnapshot } from "../domain/invoice.ts"
import type { InvoicingTransaction } from "./ports.ts"

export type Authorize = (permission: string) => Effect.Effect<RequestContext, InvoicingFailure>

export interface OperationDependencies {
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly store: TransactionalStore<InvoicingTransaction>
}

export const checked = <Value>(operation: () => Value): Effect.Effect<Value, ValidationFailure> => Effect.try({
  try: operation,
  catch: (error) => error instanceof ValidationFailure
    ? error
    : new ValidationFailure({ issues: ["invalid invoicing input"] }),
})

export const missing = (resource: string, id: string) => new ResourceNotFound({ resource, id })

export const copyParty = (party: PartySnapshot): PartySnapshot => ({
  name: party.name,
  fiscalIdentifier: party.fiscalIdentifier.trim().toUpperCase(),
  address: { ...party.address },
})

export const copyBuyer = (buyer: BuyerSnapshot): BuyerSnapshot => ({
  ...copyParty(buyer),
  partyType: buyer.partyType,
})

export const copySource = (source: DocumentSource): DocumentSource => ({
  app: source.app,
  kind: source.kind,
  id: source.id,
})
