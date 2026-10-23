import type { Effect } from "effect"

import type { DomainConflict, PersistenceFailure } from "../../../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContextProvider, TransactionalStore } from "../../../contracts/host.ts"
import type { AnafEnvironment } from "../../connection/index.ts"
import type { ConnectionState } from "../../submissions/index.ts"
import type { FetchWindow } from "../domain/fetching.ts"

type Read<Value> = Effect.Effect<Value, PersistenceFailure>
type Write<Value = void> = Effect.Effect<Value, DomainConflict | PersistenceFailure>

/** `listing` → `downloading` → `completed`, or `failed` from either. Only the first two are active. */
export type FetchState = "listing" | "downloading" | "completed" | "failed"

/** One fetch of received invoices, as a user asked for it and the dispatcher carries it out. */
export interface FetchRecord {
  readonly id: string
  readonly organizationId: string
  readonly environment: AnafEnvironment
  /** The issuer's CIF when it was asked: the one the list is for. */
  readonly cif: string
  readonly window: FetchWindow
  readonly state: FetchState
  readonly pagesListed: number
  /** ANAF's `numar_total_pagini` in its last answer; 0 before the first. */
  readonly pagesTotal: number
  /** `FACTURA PRIMITA` messages in the pages listed. */
  readonly found: number
  /** Of those, the ones this fetch downloads: new ones, and known ones never stored. */
  readonly queued: number
  readonly downloaded: number
  /** Messages it gave up after every attempt failed. */
  readonly failed: number
  /** Why it failed: the dispatcher's codes or ANAF's own texts. */
  readonly errors: ReadonlyArray<string>
  readonly createdBy: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NewFetch {
  readonly id: string
  readonly organizationId: string
  readonly environment: AnafEnvironment
  readonly cif: string
  readonly window: FetchWindow
  readonly createdBy: string
  readonly createdAt: string
}

export interface ReceivedTransaction {
  readonly findConnection: (organizationId: string) => Read<ConnectionState | undefined>
  /** The issuer's fiscal identifier as configured, `RO` prefix and all. */
  readonly findIssuerFiscalIdentifier: (organizationId: string) => Read<string | undefined>
  readonly activeFetch: (organizationId: string, environment: AnafEnvironment) => Read<FetchRecord | undefined>
  /** Up to when the organization's received invoices were fetched completely; `undefined` before the first such fetch. */
  readonly coveredUntil: (organizationId: string, environment: AnafEnvironment) => Read<string | undefined>
  readonly insertFetch: (fetch: NewFetch) => Write<FetchRecord>
}

export interface ReceivedDependencies {
  readonly context: RequestContextProvider
  /** The grant a fetch needs. */
  readonly permission: string
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly store: TransactionalStore<ReceivedTransaction>
  /** `false` while no ANAF client is configured. */
  readonly configured: boolean
  readonly environment: AnafEnvironment
}
