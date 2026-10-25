import { array, decodePage, integer, literal, nullableText, object, optionalText, text, type JsonObject } from "./model-decoder.ts"
import { decodeReceivedDocument } from "./received-document-decoders.ts"
import type {
  ReceivedDetail, ReceivedFetch, ReceivedListing, ReceivedMessage, ReceivedStatus, ReceivedSummary, ReceivedWarning,
  ReceivedWarningCode, UblFailure, Unreadable, UnreadableReason,
} from "./received-models.ts"

const KINDS = ["invoice", "credit_note"] as const
const TOTALS_CODES = ["lines_total_mismatch", "tax_inclusive_mismatch"] as const
const WARNING_CODES: ReadonlyArray<ReceivedWarningCode> = [...TOTALS_CODES, "buyer_cif_mismatch"]
const FIELD_FAILURES = ["unbound_prefix", "missing", "duplicate", "invalid"] as const
const FETCH_STATES = ["listing", "downloading", "completed", "failed"] as const

const listingOf = (input: unknown): ReceivedListing => {
  const value = object(input)
  return {
    kind: literal(KINDS, value.kind, "kind"), number: text(value.number, "number"), issueDate: text(value.issueDate, "issueDate"),
    currency: text(value.currency, "currency"), supplierName: text(value.supplierName, "supplierName"),
    supplierCif: text(value.supplierCif, "supplierCif"), totalExcludingTax: text(value.totalExcludingTax, "totalExcludingTax"),
    taxTotal: text(value.taxTotal, "taxTotal"), payable: text(value.payable, "payable"),
  }
}

const ublFailureOf = (input: unknown): UblFailure => {
  const value = object(input)
  if (value.reason === "xml") return { reason: "xml", refusal: text(value.refusal, "refusal") }
  if (value.reason === "not_ubl") return { reason: "not_ubl" }
  return { reason: literal(FIELD_FAILURES, value.reason, "reason"), field: text(value.field, "field") }
}

const reasonOf = (input: unknown): UnreadableReason => {
  const value = object(input)
  if (value.source === "zip") return { source: "zip", refusal: text(value.refusal, "refusal") }
  if (value.source === "encoding") return { source: "encoding" }
  if (value.source === "ubl") return { source: "ubl", failure: ublFailureOf(value.failure) }
  throw new Error("invalid reason")
}

const messageOf = (value: JsonObject): ReceivedMessage => ({
  messageId: text(value.messageId, "messageId"), spvCreatedAt: text(value.spvCreatedAt, "spvCreatedAt"), storedAt: text(value.storedAt, "storedAt"),
})

const unreadableOf = (value: JsonObject): Unreadable | undefined => {
  if (value.readable === true) return undefined
  if (value.readable !== false) throw new Error("invalid readable")
  return { readable: false, reason: reasonOf(value.reason) }
}

export const decodeReceivedSummary = (input: unknown): ReceivedSummary => {
  const value = object(input)
  const unreadable = unreadableOf(value)
  if (unreadable !== undefined) return { ...messageOf(value), ...unreadable }
  return {
    ...messageOf(value), readable: true, listing: listingOf(value.listing), dueDate: optionalText(value.dueDate, "dueDate"),
    warnings: array(value.warnings, (code) => literal(WARNING_CODES, code, "warning"), "warnings"),
  }
}

export const decodeReceivedPage = decodePage(decodeReceivedSummary)

const warningOf = (input: unknown): ReceivedWarning => {
  const value = object(input)
  if (value.code === "buyer_cif_mismatch") {
    return { code: "buyer_cif_mismatch", expected: text(value.expected, "expected"), found: array(value.found, (cif) => text(cif, "found"), "found") }
  }
  return { code: literal(TOTALS_CODES, value.code, "code"), declared: text(value.declared, "declared"), computed: text(value.computed, "computed") }
}

export const decodeReceivedDetail = (input: unknown): ReceivedDetail => {
  const value = object(input)
  const unreadable = unreadableOf(value)
  if (unreadable !== undefined) return { ...messageOf(value), ...unreadable }
  return {
    ...messageOf(value), readable: true, listing: listingOf(value.listing), document: decodeReceivedDocument(value.content),
    warnings: array(value.warnings, warningOf, "warnings"),
  }
}

const gapOf = (input: unknown): ReceivedFetch["window"]["gap"] => {
  if (input === undefined || input === null) return undefined
  const value = object(input)
  return { from: text(value.from, "gap.from"), until: text(value.until, "gap.until") }
}

export const decodeReceivedFetch = (input: unknown): ReceivedFetch => {
  const value = object(input)
  const window = object(value.window)
  return {
    id: text(value.id, "id"), state: literal(FETCH_STATES, value.state, "state"),
    window: { start: text(window.start, "window.start"), end: text(window.end, "window.end"), gap: gapOf(window.gap) },
    pagesListed: integer(value.pagesListed, "pagesListed"), pagesTotal: integer(value.pagesTotal, "pagesTotal"),
    found: integer(value.found, "found"), queued: integer(value.queued, "queued"), downloaded: integer(value.downloaded, "downloaded"),
    failed: integer(value.failed, "failed"), errors: array(value.errors, (error) => text(error, "errors"), "errors"),
  }
}

export const decodeReceivedStatus = (input: unknown): ReceivedStatus => {
  const value = object(input)
  return {
    fetch: value.fetch === null ? null : decodeReceivedFetch(value.fetch),
    coveredUntil: nullableText(value.coveredUntil, "coveredUntil"),
  }
}
