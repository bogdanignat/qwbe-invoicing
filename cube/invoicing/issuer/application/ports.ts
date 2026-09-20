import type { Effect } from "effect"

import type { TransactionFailure } from "../../application/ports.ts"
import type { PersistenceFailure, ValidationFailure } from "../../contracts/failures.ts"
import type { IssuerBrandingImage } from "../../domain/invoice.ts"
import type { IssuerProfile } from "../domain/issuer.ts"

// The host composes this port with the others over one transaction, so issuer
// configuration and its audit event commit or roll back together.
export interface IssuerTransaction {
  readonly saveIssuer: (issuer: IssuerProfile) => Effect.Effect<void, TransactionFailure>
  readonly findIssuer: (organizationId: string) => Effect.Effect<IssuerProfile | undefined, PersistenceFailure>
}

export interface BrandingNormalizer {
  readonly normalize: (input: Uint8Array) => Effect.Effect<IssuerBrandingImage, ValidationFailure>
}
