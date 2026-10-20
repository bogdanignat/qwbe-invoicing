import { UNRECOGNIZED, anafId, interrupted, sanitizedMessages, type AnafReply, type Interrupted } from "./replies.ts"
import type { FiscalEvent } from "./states.ts"

/**
 * The answers ANAF writes as JSON (`validare`, `listaMesajePaginatieFactura`)
 * and the ZIP of `descarcare`, whose errors come back as JSON with HTTP 200.
 * Only shapes recognised field by field count as answers.
 */
type Json = Readonly<Record<string, unknown>>

const jsonObject = (text: string): Json | undefined => {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Json : undefined
  } catch {
    return undefined
  }
}

const fieldOf = (entry: unknown, name: string): unknown =>
  typeof entry === "object" && entry !== null && !Array.isArray(entry) ? (entry as Json)[name] : undefined

const answerOf = (reply: AnafReply): Json | undefined => reply.status === 200 ? jsonObject(reply.body) : undefined

export type ValidationResult =
  | { readonly kind: "valid" }
  | { readonly kind: "invalid"; readonly errors: ReadonlyArray<string> }
  | Interrupted
  | typeof UNRECOGNIZED

/** `validare/FACT1|FCN`: `stare: "ok"`, or `stare: "nok"` with `Messages[].message`. */
export const classifyValidation = (reply: AnafReply): ValidationResult => {
  const answer = answerOf(reply)
  if (answer === undefined) return interrupted(reply) ?? UNRECOGNIZED
  if (answer.stare === "ok") return { kind: "valid" }
  const messages = Array.isArray(answer.Messages) ? answer.Messages.map((entry: unknown) => fieldOf(entry, "message")) : []
  const errors = sanitizedMessages(messages)
  return answer.stare === "nok" && errors.length > 0 ? { kind: "invalid", errors } : UNRECOGNIZED
}

/** Validation is idempotent: anything but a verdict sends the submission back to the queue. */
export const validationEvent = (result: ValidationResult): FiscalEvent =>
  result.kind === "valid" ? "validation_passed" : result.kind === "invalid" ? "validation_failed" : "validation_retry"

export interface ListedMessage {
  readonly id: string
  /** `id_solicitare`: the upload index the message answers. */
  readonly uploadIndex: string
  readonly cif: string
  readonly type: string
  /** `data_creare`, as ANAF writes it (`YYYYMMDDHHmm`). */
  readonly createdAt: string
  readonly details: string
}

export type ListResult =
  | { readonly kind: "messages"; readonly messages: ReadonlyArray<ListedMessage>; readonly pages: number }
  | { readonly kind: "no_right" }
  | { readonly kind: "anaf_error"; readonly errors: ReadonlyArray<string> }
  | Interrupted
  | typeof UNRECOGNIZED

const text = (value: unknown): string | undefined => typeof value === "string" ? value : undefined

const listed = (entry: unknown): ListedMessage | undefined => {
  const [id, uploadIndex, cif] = ["id", "id_solicitare", "cif"].map((name) => anafId(fieldOf(entry, name)))
  const [type, createdAt, details] = ["tip", "data_creare", "detalii"].map((name) => text(fieldOf(entry, name)))
  if (id === undefined || uploadIndex === undefined || cif === undefined || type === undefined || createdAt === undefined) return undefined
  return { id, uploadIndex, cif, type, createdAt, details: sanitizedMessages([details ?? ""])[0] ?? "" }
}

/**
 * `listaMesajePaginatieFactura`. An empty window is ANAF's `eroare` "Nu exista
 * mesaje…", which still proves the right on the CIF; a missing right is told
 * apart by its text. Both texts are confirmed against ANAF TEST in task 6.
 */
export const classifyList = (reply: AnafReply): ListResult => {
  const answer = answerOf(reply)
  if (answer === undefined) return interrupted(reply) ?? UNRECOGNIZED
  if (Array.isArray(answer.mesaje)) {
    const messages = answer.mesaje.map(listed)
    const pages = answer.numar_total_pagini
    if (messages.some((message) => message === undefined) || typeof pages !== "number" || !Number.isSafeInteger(pages) || pages < 1) return UNRECOGNIZED
    return { kind: "messages", messages: messages.filter((message) => message !== undefined), pages }
  }
  const error = text(answer.eroare)
  if (error === undefined) return UNRECOGNIZED
  if (/^Nu exista mesaje/iu.test(error)) return { kind: "messages", messages: [], pages: 0 }
  if (/\bdrept/iu.test(error)) return { kind: "no_right" }
  return { kind: "anaf_error", errors: sanitizedMessages([error]) }
}

export type DownloadResult =
  | { readonly kind: "archive"; readonly archive: Uint8Array }
  | { readonly kind: "anaf_error"; readonly errors: ReadonlyArray<string> }
  | Interrupted
  | typeof UNRECOGNIZED

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]

/** `descarcare`: a ZIP (by its local-file signature), or ANAF's `eroare` in JSON. */
export const classifyDownload = (reply: AnafReply<Uint8Array>): DownloadResult => {
  const stopped = interrupted(reply)
  if (stopped !== undefined) return stopped
  if (reply.status !== 200) return UNRECOGNIZED
  if (ZIP_SIGNATURE.every((byte, index) => reply.body[index] === byte)) return { kind: "archive", archive: reply.body }
  let decoded: string
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(reply.body)
  } catch {
    return UNRECOGNIZED
  }
  const error = text(jsonObject(decoded)?.eroare)
  return error === undefined ? UNRECOGNIZED : { kind: "anaf_error", errors: sanitizedMessages([error]) }
}
