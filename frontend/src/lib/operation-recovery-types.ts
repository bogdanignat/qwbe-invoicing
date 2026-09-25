/**
 * The shapes the operation recovery journal stores, and the only way stored
 * text is turned back into them.
 *
 * Storage is a hostile input like any other: the text may have been written by
 * an older build, truncated by a full quota or edited by hand, so nothing is
 * trusted as typed. Anything that does not decode exactly is `corrupt`, which
 * fails writes closed rather than letting a half-read intent through.
 */
/**
 * Every write that must survive a lost answer, invoices and proformas alike.
 *
 * The union is closed and the stored text is matched against it exactly:
 * an operation this build does not know is `corrupt`, never "probably fine".
 */
export type RecoveryOperation =
  | "create-draft"
  | "issue-invoice"
  | "create-proforma"
  | "convert-proforma-invoice"
  | "convert-proforma-draft"

/** What the recovery card shows: enough to recognise the document, never enough to rebuild it. */
export interface RecoverySummary {
  readonly buyerName: string
  readonly series: string
  readonly issueDate: string
  readonly lineCount: number
}

/**
 * The request exactly as it was sent, kept opaque on purpose: a replay resends
 * these bytes, not a payload re-derived from a form the user may have edited
 * since. No token and no CSRF value ever enters it — those belong to the
 * session, and the session is not what is being recovered.
 */
export type RecoveryRequest =
  | { readonly kind: "create-draft"; readonly body: unknown }
  | { readonly kind: "issue-draft"; readonly draftId: string }
  | { readonly kind: "issue-invoice"; readonly body: unknown }
  | { readonly kind: "create-proforma"; readonly body: unknown }
  /** A conversion names the proforma it starts from: the id is part of the path, not of the body. */
  | { readonly kind: "convert-proforma-invoice"; readonly proformaId: string; readonly body: unknown }
  | { readonly kind: "convert-proforma-draft"; readonly proformaId: string; readonly body: unknown }

export interface RecoveryRecord {
  readonly version: 1
  readonly operation: RecoveryOperation
  readonly key: string
  readonly request: RecoveryRequest
  readonly fingerprint: string
  readonly createdAt: string
  readonly summary: RecoverySummary
  /** `conflict` preserves a refusal the server settled: evidence to read, never a key to rotate. */
  readonly state: "pending" | "conflict"
  readonly conflict?: string
}

/** What survives an auth expiry: that something is unresolved, and nothing else. */
export interface RecoveryMarker {
  readonly version: 1
  readonly operation: RecoveryOperation
  readonly createdAt: string
}

export type JournalEntry =
  | { readonly kind: "empty" }
  | { readonly kind: "record"; readonly record: RecoveryRecord }
  | { readonly kind: "marker"; readonly marker: RecoveryMarker }
  | { readonly kind: "corrupt" }
  | { readonly kind: "unavailable" }

export const RECOVERY_VERSION = 1

const fields = (input: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Readonly<Record<string, unknown>>
    : undefined

const string = (input: unknown): string | undefined => typeof input === "string" ? input : undefined

/**
 * The operations this build knows, as a total record rather than a list.
 *
 * `satisfies` checks both directions at compile time: an operation added to the
 * union without an entry here does not compile, and an entry that names no
 * operation does not either. A list could not do that — it would type-check
 * while missing a member, and valid stored records would silently become
 * `corrupt`, which blocks every write behind a card about nothing.
 */
const OPERATIONS = {
  "create-draft": true, "issue-invoice": true, "create-proforma": true,
  "convert-proforma-invoice": true, "convert-proforma-draft": true,
} satisfies Readonly<Record<RecoveryOperation, true>>

const isOperation = (value: string): value is RecoveryOperation => Object.hasOwn(OPERATIONS, value)

const operation = (input: unknown): RecoveryOperation | undefined => {
  const value = string(input)
  return value !== undefined && isOperation(value) ? value : undefined
}

/**
 * Which operation each stored request belongs to, again as a total record.
 *
 * It answers two questions with one statement: whether a stored `kind` is one
 * this build can send, and which operation the card may name alongside it.
 * Issuing is the only operation with two requests — from a saved draft the
 * server is sent an id, otherwise the whole document — and both are still the
 * one operation the user started.
 */
const REQUEST_OPERATION: Readonly<Record<RecoveryRequest["kind"], RecoveryOperation>> = {
  "create-draft": "create-draft", "issue-draft": "issue-invoice", "issue-invoice": "issue-invoice",
  "create-proforma": "create-proforma", "convert-proforma-invoice": "convert-proforma-invoice",
  "convert-proforma-draft": "convert-proforma-draft",
}

const isRequestKind = (value: string): value is RecoveryRequest["kind"] =>
  Object.hasOwn(REQUEST_OPERATION, value)

/**
 * The operation a request belongs to, for the write path.
 *
 * Decoding already refuses a stored record whose two halves disagree, but that
 * only catches text written by an older build; a caller that pairs today's
 * request with the wrong operation would write such a record itself, and the
 * only reason it would be noticed is a reload. Naming the mapping once lets the
 * claim refuse it at the source, with the same total record behind both checks.
 */
export const operationOf = (request: RecoveryRequest): RecoveryOperation => REQUEST_OPERATION[request.kind]

const summary = (input: unknown): RecoverySummary | undefined => {
  const value = fields(input)
  if (value === undefined) return undefined
  const buyerName = string(value.buyerName)
  const series = string(value.series)
  const issueDate = string(value.issueDate)
  const lineCount = value.lineCount
  if (buyerName === undefined || series === undefined || issueDate === undefined) return undefined
  if (typeof lineCount !== "number" || !Number.isInteger(lineCount) || lineCount < 0) return undefined
  return { buyerName, series, issueDate, lineCount }
}

const request = (input: unknown): RecoveryRequest | undefined => {
  const value = fields(input)
  if (value === undefined) return undefined
  const kind = string(value.kind)
  if (kind === undefined || !isRequestKind(kind)) return undefined
  if (kind === "issue-draft") {
    const draftId = string(value.draftId)
    return draftId === undefined ? undefined : { kind, draftId }
  }
  if (!("body" in value)) return undefined
  if (kind === "convert-proforma-invoice" || kind === "convert-proforma-draft") {
    const proformaId = string(value.proformaId)
    return proformaId === undefined ? undefined : { kind, proformaId, body: value.body }
  }
  return { kind, body: value.body }
}

const record = (value: Readonly<Record<string, unknown>>): RecoveryRecord | undefined => {
  const kind = operation(value.operation)
  const key = string(value.key)
  const fingerprint = string(value.fingerprint)
  const createdAt = string(value.createdAt)
  const intent = request(value.request)
  const shown = summary(value.summary)
  const state = value.state === "pending" || value.state === "conflict" ? value.state : undefined
  const conflict = string(value.conflict)
  if (kind === undefined || key === undefined || fingerprint === undefined) return undefined
  if (createdAt === undefined || intent === undefined || shown === undefined || state === undefined) return undefined
  // The pair has to agree: the operation names the card the user confirms and
  // the request names the call a replay sends. A record whose two halves
  // disagree would title one write and send another, so it is corrupt.
  if (operationOf(intent) !== kind) return undefined
  return {
    version: RECOVERY_VERSION, operation: kind, key, request: intent, fingerprint,
    createdAt, summary: shown, state, ...(conflict === undefined ? {} : { conflict }),
  }
}

export const decodeJournalEntry = (raw: string | null): JournalEntry => {
  if (raw === null || raw === "") return { kind: "empty" }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { kind: "corrupt" }
  }
  const value = fields(parsed)
  if (value === undefined || value.version !== RECOVERY_VERSION) return { kind: "corrupt" }
  if (value.kind === "marker") {
    const kind = operation(value.operation)
    const createdAt = string(value.createdAt)
    return kind === undefined || createdAt === undefined
      ? { kind: "corrupt" }
      : { kind: "marker", marker: { version: RECOVERY_VERSION, operation: kind, createdAt } }
  }
  const decoded = record(value)
  return decoded === undefined ? { kind: "corrupt" } : { kind: "record", record: decoded }
}
