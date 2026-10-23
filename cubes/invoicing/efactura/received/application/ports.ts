import type { Effect } from "effect"

import type {
  AuthenticationRequired, DomainConflict, OrganizationContextMissing, PermissionDenied, PersistenceFailure, ResourceNotFound, ValidationFailure,
} from "../../../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContextProvider, TransactionalStore } from "../../../contracts/host.ts"
import type { PageQuery } from "../../../application/ports.ts"
import type { AnafEnvironment, EFacturaPermissions } from "../../connection/index.ts"
import type { ReceivedDocument, ReceivedWarning } from "../../received-ubl/index.ts"
import type { ConnectionState } from "../../submissions/index.ts"
import type { FetchWindow } from "../domain/fetching.ts"
import type { ReceivedListing, UnreadableReason } from "../domain/interpretation.ts"

export type ReceivedFailure =
  | AuthenticationRequired | OrganizationContextMissing | PermissionDenied | DomainConflict | PersistenceFailure | ResourceNotFound | ValidationFailure

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

/** A stored received invoice: ANAF's message, by its id. */
export interface ReceivedMessage {
  readonly messageId: string
  /** ANAF's `data_creare` as listed: `YYYYMMDDHHmm`, Romanian time. */
  readonly spvCreatedAt: string
  readonly storedAt: string
}

/** What the list shows of one: the columns of a read invoice and how many warnings it has, or why it is unreadable. */
export type ReceivedSummary = ReceivedMessage & (
  | { readonly readable: true; readonly listing: ReceivedListing; readonly warnings: number }
  | { readonly readable: false; readonly reason: UnreadableReason })

/** One received invoice in full: the whole normalized document and its warnings, or why it is unreadable. */
export type ReceivedDetail = ReceivedMessage & (
  | {
    readonly readable: true
    readonly listing: ReceivedListing
    readonly content: ReceivedDocument
    readonly warnings: ReadonlyArray<ReceivedWarning>
  }
  | { readonly readable: false; readonly reason: UnreadableReason })

/** The list is newest first in the SPV: `data_creare`, then the message id. */
export interface ReceivedCursor { readonly spvCreatedAt: string; readonly messageId: string }

/** Every read is of one organization in one environment. */
export interface ReceivedScope { readonly organizationId: string; readonly environment: AnafEnvironment }

export interface ReceivedReads {
  readonly latestFetch: (scope: ReceivedScope) => Read<FetchRecord | undefined>
  /** At most `limit + 1` rows, after the cursor. */
  readonly listReceived: (scope: ReceivedScope, page: PageQuery<ReceivedCursor>) => Read<ReadonlyArray<ReceivedSummary>>
  readonly findReceived: (scope: ReceivedScope, messageId: string) => Read<ReceivedDetail | undefined>
  /** ANAF's ZIP exactly as it came. */
  readonly readArchive: (scope: ReceivedScope, messageId: string) => Read<Uint8Array | undefined>
}

export interface ReceivedTransaction extends ReceivedReads {
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
  /** `read` for every read, `receive` for a fetch. */
  readonly permissions: EFacturaPermissions
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly store: TransactionalStore<ReceivedTransaction>
  /** `false` while no ANAF client is configured. */
  readonly configured: boolean
  readonly environment: AnafEnvironment
}
