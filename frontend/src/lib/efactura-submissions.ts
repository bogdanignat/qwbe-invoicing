import { array, boolean, integer, literal, nullableText, object, text, type Decoder } from "./model-decoder.ts"

/**
 * The e-Factura submissions of one document and the reconciliation candidates
 * of an `unknown` one (`kernel/api/http-endpoints-efactura-*.ts`). Every literal
 * the screen branches on is checked against its list, and the pairs the backend
 * keeps together (an index on a processed submission, a stored archive on a
 * decided one) are asserted, so an answer the screen cannot explain fails here.
 */
export const FISCAL_STATES = ["queued", "validating", "uploading", "processing", "accepted", "rejected", "refused", "unknown"] as const
export type FiscalState = typeof FISCAL_STATES[number]
const ARCHIVE_STATES = ["none", "pending", "stored"] as const
export type SubmittedKind = "invoice" | "correction"

export interface EFacturaSubmission {
  readonly id: string
  readonly environment: "test" | "prod"
  readonly documentKind: SubmittedKind
  readonly documentId: string
  readonly cif: string
  readonly state: FiscalState
  readonly archiveState: typeof ARCHIVE_STATES[number]
  readonly uploadIndex: string | null
  readonly errors: ReadonlyArray<string>
  readonly superseded: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

export interface EFacturaResubmission {
  readonly previousId: string
  readonly nextId: string
  readonly createdAt: string
}

export interface EFacturaHistory {
  readonly current: EFacturaSubmission | null
  readonly submissions: ReadonlyArray<EFacturaSubmission>
  readonly resubmissions: ReadonlyArray<EFacturaResubmission>
}

const filled = (input: unknown, field: string): string => {
  const value = text(input, field)
  if (value === "") throw new Error(`invalid ${field}`)
  return value
}
const message = (input: unknown): string => text(input, "errors")

export const decodeEFacturaSubmission: Decoder<EFacturaSubmission> = (input) => {
  const value = object(input)
  const submission: EFacturaSubmission = {
    id: filled(value.id, "id"),
    environment: literal(["test", "prod"], value.environment, "environment"),
    documentKind: literal(["invoice", "correction"], value.documentKind, "documentKind"),
    documentId: filled(value.documentId, "documentId"),
    cif: filled(value.cif, "cif"),
    state: literal(FISCAL_STATES, value.state, "state"),
    archiveState: literal(ARCHIVE_STATES, value.archiveState, "archiveState"),
    uploadIndex: nullableText(value.uploadIndex, "uploadIndex"),
    errors: array(value.errors, message, "errors"),
    superseded: boolean(value.superseded, "superseded"),
    createdAt: filled(value.createdAt, "createdAt"),
    updatedAt: filled(value.updatedAt, "updatedAt"),
  }
  const indexed = submission.state === "processing" || submission.state === "accepted" || submission.state === "rejected"
  if (indexed && submission.uploadIndex === null) throw new Error("invalid uploadIndex")
  if (submission.superseded && submission.state !== "unknown") throw new Error("invalid superseded")
  return submission
}

const decodeResubmission: Decoder<EFacturaResubmission> = (input) => {
  const value = object(input)
  return {
    previousId: filled(value.previousId, "previousId"),
    nextId: filled(value.nextId, "nextId"),
    createdAt: filled(value.createdAt, "createdAt"),
  }
}

export const decodeEFacturaHistory = (input: unknown, kind: SubmittedKind, documentId: string): EFacturaHistory => {
  const value = object(input)
  const history = {
    current: value.current === null ? null : decodeEFacturaSubmission(value.current),
    submissions: array(value.submissions, decodeEFacturaSubmission, "submissions"),
    resubmissions: array(value.resubmissions, decodeResubmission, "resubmissions"),
  }
  // The history of this document only, and its current submission is the newest one still standing.
  if (history.submissions.some((s) => s.documentKind !== kind || s.documentId !== documentId)) throw new Error("invalid submissions")
  if ((history.current?.id ?? null) !== (history.submissions.find((s) => !s.superseded)?.id ?? null)) throw new Error("invalid current")
  return history
}

export interface EFacturaCandidate {
  readonly uploadIndex: string
  readonly createdAt: string
  readonly type: string
  readonly linked: boolean
}

export interface EFacturaCandidates {
  readonly page: number
  readonly pages: number
  readonly from: string
  readonly to: string
  readonly candidates: ReadonlyArray<EFacturaCandidate>
}

const decodeCandidate: Decoder<EFacturaCandidate> = (input) => {
  const value = object(input)
  return {
    uploadIndex: filled(value.uploadIndex, "uploadIndex"),
    createdAt: filled(value.createdAt, "createdAt"),
    type: filled(value.type, "type"),
    linked: boolean(value.linked, "linked"),
  }
}

export const decodeEFacturaCandidates = (input: unknown): EFacturaCandidates => {
  const value = object(input)
  const page = integer(value.page, "page")
  const pages = integer(value.pages, "pages")
  if (page < 1 || pages < 0) throw new Error("invalid page")
  return {
    page, pages,
    from: filled(value.from, "from"),
    to: filled(value.to, "to"),
    candidates: array(value.candidates, decodeCandidate, "candidates"),
  }
}
