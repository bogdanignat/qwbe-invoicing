import type { Effect } from "effect"

import type { DomainConflict, PersistenceFailure, ValidationFailure } from "../../../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContextProvider, TransactionalStore } from "../../../contracts/host.ts"
import type { AuditEvent, EFacturaStatus } from "../../../domain/invoice.ts"
import type { AnafEnvironment, EFacturaPermissions, StoredConnectionStatus } from "../../connection/index.ts"
import type { ArchiveState, FiscalState } from "../domain/states.ts"

type Read<Value> = Effect.Effect<Value, PersistenceFailure>
type Write<Value = void> = Effect.Effect<Value, DomainConflict | PersistenceFailure>

export type SubmittedKind = "invoice" | "correction"

/** A submission as stored, minus its bytes. The XML and ANAF's ZIP are read on their own. */
export interface SubmissionRecord {
  readonly id: string
  readonly organizationId: string
  readonly environment: AnafEnvironment
  readonly documentKind: SubmittedKind
  readonly documentId: string
  readonly standard: "UBL" | "CN"
  readonly cif: string
  readonly state: FiscalState
  readonly archiveState: ArchiveState
  readonly uploadIndex: string | null
  readonly downloadId: string | null
  /** ANAF's own messages, already sanitized. */
  readonly errors: ReadonlyArray<string>
  readonly superseded: boolean
  readonly xmlSha256: string
  readonly xmlSize: number
  readonly createdBy: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** A new `queued` submission. The host stores the bytes as given and derives their digest and size from them. */
export interface NewSubmission {
  readonly id: string
  readonly organizationId: string
  readonly environment: AnafEnvironment
  readonly documentKind: SubmittedKind
  readonly documentId: string
  readonly cif: string
  readonly xml: Uint8Array
  readonly createdBy: string
  readonly createdAt: string
}

/** The stored connection row, as far as a submission needs it: never a token. */
export interface ConnectionState {
  readonly status: StoredConnectionStatus
  readonly verifiedCif: string | undefined
  readonly refreshExpiresAt: string | undefined
}

/** One manual resubmission out of `unknown`: `previousId` was superseded by `nextId`. */
export interface Resubmission {
  readonly previousId: string
  readonly nextId: string
  readonly actorId: string
  readonly createdAt: string
}

export interface SubmissionsTransaction {
  /** The document's one non-superseded submission in a live state, `unknown` and `accepted` included. */
  readonly findCurrent: (organizationId: string, environment: AnafEnvironment, kind: SubmittedKind, documentId: string) =>
    Read<SubmissionRecord | undefined>
  readonly findConnection: (organizationId: string) => Read<ConnectionState | undefined>
  readonly insert: (submission: NewSubmission) => Write<SubmissionRecord>
  /** Writes the document's `e_factura_status`; fails when the document is not there. */
  readonly project: (organizationId: string, kind: SubmittedKind, documentId: string, status: EFacturaStatus) => Write
  /** Every submission of the document, newest first. */
  readonly history: (organizationId: string, kind: SubmittedKind, documentId: string) => Read<ReadonlyArray<SubmissionRecord>>
  /** The document's resubmissions, newest first. */
  readonly resubmissions: (organizationId: string, kind: SubmittedKind, documentId: string) => Read<ReadonlyArray<Resubmission>>
  readonly readXml: (organizationId: string, id: string) => Read<Uint8Array | undefined>
  readonly readResponse: (organizationId: string, id: string) => Read<Uint8Array | undefined>
  readonly appendAuditEvent: (event: AuditEvent) => Write
}

/**
 * A fiscal document as the host loaded it from its frozen snapshot. The XML is
 * generated only once every guard has passed, and the generator is the host's.
 */
export interface SubmissionDocument {
  readonly kind: SubmittedKind
  readonly id: string
  /** The issuer's fiscal identifier in the snapshot, `RO` prefix and all. */
  readonly issuerFiscalIdentifier: string
  readonly buyerIsIndividual: boolean
  readonly xml: Effect.Effect<Uint8Array, ValidationFailure>
}

export interface SubmissionsDependencies {
  readonly context: RequestContextProvider
  readonly permissions: EFacturaPermissions
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly store: TransactionalStore<SubmissionsTransaction>
  /** `false` while no ANAF client is configured: nothing can be submitted. */
  readonly configured: boolean
  readonly environment: AnafEnvironment
}
