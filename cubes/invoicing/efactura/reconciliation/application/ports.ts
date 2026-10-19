import type { Effect, Redacted } from "effect"

import type { DomainConflict, PersistenceFailure } from "../../../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContextProvider, TransactionalStore } from "../../../contracts/host.ts"
import type { AnafEnvironment, EFacturaPermissions } from "../../connection/index.ts"
import type {
  AnafReply, CallOutcome, FiscalState, Resubmission, SubmissionRecord, SubmissionsTransaction,
} from "../../submissions/index.ts"

type Read<Value> = Effect.Effect<Value, PersistenceFailure>
type Write<Value = void> = Effect.Effect<Value, DomainConflict | PersistenceFailure>

/** One `listaMesajePaginatieFactura` call, as `efactura_submission_attempts` keeps it: never a body, never a token. */
export interface LoggedCall {
  readonly outcome: CallOutcome
  readonly httpStatus: number | undefined
  readonly durationMs: number
  readonly startedAt: string
}

/** The pair a request may call ANAF with. It is never refreshed by a request: a refusal asks the dispatcher. */
export interface RequestToken {
  readonly access: Redacted.Redacted
  readonly verifiedCif: string
  readonly generation: number
  readonly revision: number
}

export interface ListQuery {
  readonly cif: string
  readonly startTime: number
  readonly endTime: number
  /** 1-based. */
  readonly page: number
}

/** ANAF's answer, or how the transport failed, and how long it took. */
export interface ListCall {
  readonly reply: AnafReply | "not_sent" | "ambiguous"
  readonly startedAt: string
  readonly durationMs: number
}

export interface ReconciliationTransaction extends SubmissionsTransaction {
  readonly find: (organizationId: string, id: string) => Read<SubmissionRecord | undefined>
  /** The submission that already holds `uploadIndex` in this organization and environment. */
  readonly findByUploadIndex: (organizationId: string, environment: AnafEnvironment, uploadIndex: string) => Read<SubmissionRecord | undefined>
  /** The submission that replaced `previousId`, once it was resubmitted. */
  readonly replacement: (organizationId: string, previousId: string) => Read<SubmissionRecord | undefined>
  /** One call more this minute for the organization; or the instant to come back at. */
  readonly reserveCall: (organizationId: string, at: Date) => Write<string | undefined>
  readonly logCall: (submission: SubmissionRecord, call: LoggedCall) => Write
  /** ANAF answered 429: the whole organization waits. */
  readonly pause: (organizationId: string, retryAfter: string | null, at: Date) => Write
  /** Asks the dispatcher to refresh exactly this pair; a newer pair is left alone. */
  readonly requestRefresh: (organizationId: string, token: RequestToken) => Write
  /** `unknown` → `state` with ANAF's index; polling starts at `at`. Fails unless the row is still a current `unknown`. */
  readonly link: (submission: SubmissionRecord, state: FiscalState, uploadIndex: string, at: string) => Write<SubmissionRecord>
  /** Marks a current `unknown` submission superseded; its state stays `unknown`. */
  readonly supersede: (submission: SubmissionRecord, at: string) => Write
  readonly recordResubmission: (organizationId: string, resubmission: Resubmission) => Write
}

/** ANAF, as far as a request may reach it: a read of the stored pair and the read-only list. */
export interface ReconciliationAnaf {
  readonly token: (organizationId: string) => Read<RequestToken | undefined>
  readonly list: (token: Redacted.Redacted, query: ListQuery) => Effect.Effect<ListCall>
}

export interface ReconciliationDependencies {
  readonly context: RequestContextProvider
  readonly permissions: EFacturaPermissions
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly store: TransactionalStore<ReconciliationTransaction>
  /** `undefined` while no ANAF client is configured. */
  readonly anaf: ReconciliationAnaf | undefined
  readonly environment: AnafEnvironment
}
