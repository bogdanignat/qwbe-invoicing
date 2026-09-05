import { Effect } from "effect"

import { ResourceNotFound, ValidationFailure } from "../contracts/failures.ts"
import type { BuyerSnapshot, DocumentSource, PartySnapshot } from "../domain/invoice.ts"

export const checked = <Value>(operation: () => Value): Effect.Effect<Value, ValidationFailure> => Effect.try({
  try: operation,
  catch: (error) => error instanceof ValidationFailure
    ? error
    : new ValidationFailure({ issues: ["invalid invoicing input"] }),
})

export const missing = (resource: string, id: string) => new ResourceNotFound({ resource, id })

export const copyParty = (party: PartySnapshot): PartySnapshot => ({
  legalName: party.legalName,
  taxIdentifier: party.taxIdentifier.trim().toUpperCase(),
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
