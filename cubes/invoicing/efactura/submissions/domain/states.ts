/**
 * Where a submission stands at ANAF, and the only moves between those places.
 *
 * `uploading` is committed before the upload's POST leaves, so a crash, a
 * timeout or any answer that does not say what happened leaves the document
 * either at ANAF or not, and nobody can tell which: that is `unknown`, and
 * nothing here ever sends it again on its own. The one way back to `queued`
 * from `uploading` is an explicit 401/403 from ANAF: the request was refused at
 * authentication, so it was not taken.
 */
export const FISCAL_STATES = ["queued", "validating", "uploading", "processing", "accepted", "rejected", "refused", "unknown"] as const
export type FiscalState = (typeof FISCAL_STATES)[number]

/** The ANAF answer (ZIP) of a decided submission: not yet asked for, being fetched, stored. */
export const ARCHIVE_STATES = ["none", "pending", "stored"] as const
export type ArchiveState = (typeof ARCHIVE_STATES)[number]

/** The states a document has at most one non-superseded submission in (the `efactura_submissions_current` index). */
export const LIVE_STATES: ReadonlyArray<FiscalState> = ["queued", "validating", "uploading", "processing", "accepted", "unknown"]

interface Move {
  readonly from: ReadonlyArray<FiscalState>
  readonly to: FiscalState
}

/**
 * Every allowed transition, by the event that causes it. Anything not written
 * here is refused; the type makes each event appear exactly once.
 */
export const FISCAL_TRANSITIONS = {
  /** The dispatcher picks a queued submission and asks `validare`. */
  validation_started: { from: ["queued"], to: "validating" },
  /** `validare` said nothing against it; the upload is next. */
  validation_passed: { from: ["validating"], to: "uploading" },
  /** `validare` listed errors: nothing was sent. */
  validation_failed: { from: ["validating"], to: "refused" },
  /** `validare` could not be asked or answered unclearly; it is idempotent, so it is asked again later. */
  validation_retry: { from: ["validating"], to: "queued" },
  /** ANAF answered the upload with an index. */
  upload_indexed: { from: ["uploading"], to: "processing" },
  /** ANAF answered the upload with errors and no index (`ExecutionStatus="1"`). */
  upload_refused: { from: ["uploading"], to: "refused" },
  /** An explicit 401/403 from ANAF: refused at authentication, so not taken. Retried after a token refresh. */
  upload_auth_refused: { from: ["uploading"], to: "queued" },
  /** Every other upload outcome: timeout, broken connection, 3xx/5xx/429, malformed or oversized body. */
  upload_ambiguous: { from: ["uploading"], to: "unknown" },
  /** `stareMesaj` said `ok`. */
  processing_accepted: { from: ["processing"], to: "accepted" },
  /** `stareMesaj` said `nok` (or `XML cu erori…` with a download id). */
  processing_rejected: { from: ["processing"], to: "rejected" },
  /** `stareMesaj` said the XML was not taken and gave no download id. */
  processing_refused: { from: ["processing"], to: "refused" },
  /** Recovery after a restart: an upload that was in flight may have arrived. */
  recovered_upload: { from: ["uploading"], to: "unknown" },
  /** Recovery after a restart: validation is idempotent, so it simply starts over. */
  recovered_validation: { from: ["validating"], to: "queued" },
  /** Restore from a backup: nothing that might still leave is allowed to leave. */
  restored: { from: ["queued", "validating", "uploading"], to: "unknown" },
  /** Reconciliation: the user confirmed an index ANAF lists for this CIF and window. */
  linked: { from: ["unknown"], to: "processing" },
} as const satisfies Readonly<Record<string, Move>>

export type FiscalEvent = keyof typeof FISCAL_TRANSITIONS

/** The next state, or `undefined` when the event is not allowed from `state`. */
export const fiscalTransition = (state: FiscalState, event: FiscalEvent): FiscalState | undefined => {
  const move: Move = FISCAL_TRANSITIONS[event]
  return move.from.includes(state) ? move.to : undefined
}

/** Whether a decided submission may still be superseded by a manual resubmission: only from `unknown`. */
export const canSupersede = (state: FiscalState): boolean => state === "unknown"

const decided = (state: FiscalState): boolean => state === "accepted" || state === "rejected"

/** The archive state that goes with a new fiscal state: ANAF's decision opens the download of its answer. */
export const archiveFor = (state: FiscalState): ArchiveState => decided(state) ? "pending" : "none"

/** ANAF's answer is stored once, for a decided submission whose download is pending. */
export const canStoreArchive = (state: FiscalState, archive: ArchiveState): boolean => decided(state) && archive === "pending"

/** What the document shows of its current submission (`e_factura_status`): validation and upload read as `processing`. */
export const documentStatus = (state: FiscalState): Exclude<FiscalState, "validating" | "uploading"> =>
  state === "validating" || state === "uploading" ? "processing" : state
