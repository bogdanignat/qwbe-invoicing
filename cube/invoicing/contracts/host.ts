import type { Effect } from "effect"

import type {
  AuthenticationRequired,
  OrganizationContextMissing,
  PersistenceFailure,
  RenderingFailure,
} from "./failures.ts"

export interface CurrentIdentity {
  readonly id: string
  readonly username: string
  readonly roles: ReadonlyArray<string>
  readonly permissions: ReadonlyArray<string>
}

export interface CurrentOrganization {
  readonly id: string
}

export interface RequestContext {
  readonly identity: CurrentIdentity
  readonly organization: CurrentOrganization
}

export interface RequestContextProvider {
  readonly current: Effect.Effect<
    RequestContext,
    AuthenticationRequired | OrganizationContextMissing
  >
}

export interface Clock {
  readonly now: Effect.Effect<Date>
}

export interface IdGenerator {
  readonly next: Effect.Effect<string>
}

export interface TransactionalStore<Transaction> {
  readonly transaction: <Value, Failure, Requirements>(
    use: (transaction: Transaction) => Effect.Effect<Value, Failure, Requirements>,
  ) => Effect.Effect<Value, Failure | PersistenceFailure, Requirements>
}

export interface RenderedDocument {
  readonly bytes: Uint8Array
  readonly mediaType: "application/pdf"
  readonly templateVersion: string
}

export interface InvoiceRenderer<Snapshot> {
  readonly render: (snapshot: Snapshot) => Effect.Effect<RenderedDocument, RenderingFailure>
}

export interface HostCapabilities<Transaction, Snapshot> {
  readonly context: RequestContextProvider
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly store: TransactionalStore<Transaction>
  readonly renderer: InvoiceRenderer<Snapshot>
}
