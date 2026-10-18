import type { Effect } from "effect"

import type { AuthenticationRequired, OrganizationContextMissing, PersistenceFailure } from "./failures.ts"

export interface RequestContext {
  readonly identity: {
    readonly id: string
    readonly username: string
    readonly roles: ReadonlyArray<string>
    readonly permissions: ReadonlyArray<string>
  }
  readonly organization: { readonly id: string }
}
export interface RequestContextProvider {
  readonly current: Effect.Effect<RequestContext, AuthenticationRequired | OrganizationContextMissing>
}
export interface Clock { readonly now: Effect.Effect<Date> }
export interface IdGenerator { readonly next: Effect.Effect<string> }
export interface TransactionalStore<Transaction> {
  readonly transaction: <Value, Failure, Requirements>(
    use: (transaction: Transaction) => Effect.Effect<Value, Failure, Requirements>,
  ) => Effect.Effect<Value, Failure | PersistenceFailure, Requirements>
}
