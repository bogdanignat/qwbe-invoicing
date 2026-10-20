import { UNRECOGNIZED, anafId, interrupted, sanitizedMessages, type AnafReply, type Interrupted } from "./replies.ts"
import type { FiscalEvent } from "./states.ts"
import { childrenNamed, localName, parseStrictXml, type XmlElement } from "./xml.ts"

/**
 * The two answers ANAF writes as XML: `upload` and `stareMesaj`. Both are one
 * `header` element whose attributes carry the result and whose `Errors`
 * children carry ANAF's messages; an error can arrive with HTTP 200.
 */
const header = (reply: AnafReply): XmlElement | undefined => {
  if (reply.status !== 200) return undefined
  const parsed = parseStrictXml(reply.body)
  return parsed.ok && localName(parsed.root.name) === "header" ? parsed.root : undefined
}

const errorsOf = (element: XmlElement): ReadonlyArray<string> =>
  sanitizedMessages(childrenNamed(element, "Errors").map((error) => error.attributes.errorMessage))

export type UploadResult =
  | { readonly kind: "indexed"; readonly uploadIndex: string }
  | { readonly kind: "refused"; readonly errors: ReadonlyArray<string> }
  | { readonly kind: "auth_refused" }
  | { readonly kind: "ambiguous" }

/**
 * The upload is the one call that cannot be repeated blindly, so only two
 * shapes count as an answer: `ExecutionStatus="0"` with an index and no error,
 * or `ExecutionStatus="1"` with errors and no index. An explicit 401/403 is
 * the refusal at authentication. Everything else — 429, 3xx, 5xx, a body that
 * does not parse — leaves the document's fate open.
 */
export const classifyUpload = (reply: AnafReply): UploadResult => {
  if (reply.status === 401 || reply.status === 403) return { kind: "auth_refused" }
  const answer = header(reply)
  if (answer === undefined) return { kind: "ambiguous" }
  const { ExecutionStatus: status, index_incarcare: rawIndex } = answer.attributes
  const uploadIndex = anafId(rawIndex)
  const errors = errorsOf(answer)
  if (status === "0" && uploadIndex !== undefined && errors.length === 0) return { kind: "indexed", uploadIndex }
  if (status === "1" && rawIndex === undefined && errors.length > 0) return { kind: "refused", errors }
  return { kind: "ambiguous" }
}

export const UPLOAD_EVENTS: Readonly<Record<UploadResult["kind"], FiscalEvent>> = {
  indexed: "upload_indexed",
  refused: "upload_refused",
  auth_refused: "upload_auth_refused",
  ambiguous: "upload_ambiguous",
}

export type StatusResult =
  | { readonly kind: "accepted"; readonly downloadId: string }
  | { readonly kind: "rejected"; readonly downloadId: string }
  | { readonly kind: "refused"; readonly errors: ReadonlyArray<string> }
  | { readonly kind: "pending" }
  | { readonly kind: "anaf_error"; readonly errors: ReadonlyArray<string> }
  | Interrupted
  | typeof UNRECOGNIZED

const NOT_TAKEN = "XML cu erori nepreluat de sistem"

/** `stareMesaj`: `ok`/`nok` decide, `in prelucrare` waits, errors (no right, unknown index) are ANAF's refusal to answer. */
export const classifyStatus = (reply: AnafReply): StatusResult => {
  const stopped = interrupted(reply)
  if (stopped !== undefined) return stopped
  const answer = header(reply)
  if (answer === undefined) return UNRECOGNIZED
  const errors = errorsOf(answer)
  if (errors.length > 0) return { kind: "anaf_error", errors }
  const { stare, id_descarcare: rawDownload } = answer.attributes
  const downloadId = anafId(rawDownload)
  if (rawDownload !== undefined && downloadId === undefined) return UNRECOGNIZED
  if (stare === "in prelucrare") return { kind: "pending" }
  if (downloadId !== undefined && stare === "ok") return { kind: "accepted", downloadId }
  if (downloadId !== undefined && (stare === "nok" || stare === NOT_TAKEN)) return { kind: "rejected", downloadId }
  if (stare === NOT_TAKEN) return { kind: "refused", errors: [NOT_TAKEN] }
  return UNRECOGNIZED
}

/** The transition a status answer makes; the others leave the submission `processing` until the next poll. */
export const statusEvent = (result: StatusResult): FiscalEvent | undefined => {
  if (result.kind === "accepted") return "processing_accepted"
  if (result.kind === "rejected") return "processing_rejected"
  return result.kind === "refused" ? "processing_refused" : undefined
}
