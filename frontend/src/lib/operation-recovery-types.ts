/**
 * The shapes the operation recovery journal stores, and the only way stored
 * text is turned back into them.
 *
 * Storage is a hostile input like any other: the text may have been written by
 * an older build, truncated by a full quota or edited by hand, so nothing is
 * trusted as typed. Anything that does not decode exactly is `corrupt`, which
 * fails writes closed rather than letting a half-read intent through.
 */
export type RecoveryOperation = "create-draft" | "issue-invoice"

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

const operation = (input: unknown): RecoveryOperation | undefined =>
  input === "create-draft" || input === "issue-invoice" ? input : undefined

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
  if (value.kind === "issue-draft") {
    const draftId = string(value.draftId)
    return draftId === undefined ? undefined : { kind: "issue-draft", draftId }
  }
  if (value.kind !== "create-draft" && value.kind !== "issue-invoice") return undefined
  if (!("body" in value)) return undefined
  return { kind: value.kind, body: value.body }
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
