import { decodeDeleted, decodeDraft, decodeDraftPage } from "./draft-decoders.ts"
import { decodeIssuedInvoice } from "./document-snapshot-decoders.ts"
import { encoded, paged } from "./client-paths.ts"
import { readableWrite } from "./unreadable-answer.ts"
import type { BrowserTransport } from "./browser-transport.ts"
import type {
  AuthoringDocumentInput, CreateDraftInput, DraftLineInput, DraftInvoice, UpdateDraftInput,
} from "./draft-models.ts"
import type { IssuedInvoice } from "./document-snapshot.ts"
import type { Page, PageRequest } from "./model-decoder.ts"

/**
 * Draft and issuance endpoints, built from the session's transport.
 *
 * Every write states its CSRF token — the transport attaches nothing on its
 * own. Draft creation and the two issuance calls carry the idempotency key the
 * server replays a lost answer by; the line and header writes carry none,
 * because the server offers them none: they are not safely repeatable, which is
 * why the save controller reconciles before resuming one.
 *
 * Every write also passes through `readableWrite`: an answer that arrived but
 * could not be read is an unknown outcome, not a failed request, and the
 * recovery path depends on telling the two apart. Reads are left alone — a read
 * that cannot be decoded changed nothing on the server.
 */
export interface DraftsClient {
  readonly createDraft: (csrfToken: string, body: CreateDraftInput, idempotencyKey: string, signal?: AbortSignal) => Promise<DraftInvoice>
  /** A replay sends the stored request as it was sent, not a payload rebuilt from the current form. */
  readonly replayDraftCreation: (csrfToken: string, body: unknown, idempotencyKey: string) => Promise<DraftInvoice>
  readonly listDrafts: (page: PageRequest | undefined, signal: AbortSignal) => Promise<Page<DraftInvoice>>
  readonly getDraft: (id: string, signal: AbortSignal) => Promise<DraftInvoice>
  readonly updateDraft: (csrfToken: string, id: string, body: UpdateDraftInput) => Promise<DraftInvoice>
  readonly deleteDraft: (csrfToken: string, id: string) => Promise<void>
  readonly addDraftLine: (csrfToken: string, id: string, body: DraftLineInput) => Promise<DraftInvoice>
  readonly updateDraftLine: (csrfToken: string, id: string, lineId: string, body: DraftLineInput) => Promise<DraftInvoice>
  readonly deleteDraftLine: (csrfToken: string, id: string, lineId: string) => Promise<DraftInvoice>
  readonly issueDraft: (csrfToken: string, id: string, idempotencyKey: string) => Promise<IssuedInvoice>
  readonly issueInvoice: (csrfToken: string, body: AuthoringDocumentInput, idempotencyKey: string) => Promise<IssuedInvoice>
  readonly replayInvoiceIssuance: (csrfToken: string, body: unknown, idempotencyKey: string) => Promise<IssuedInvoice>
}

interface WriteOptions {
  readonly csrfToken: string
  readonly method: "POST" | "PUT" | "DELETE"
  readonly body?: unknown
  readonly idempotencyKey?: string
  readonly signal?: AbortSignal
}

export const createDraftsClient = (transport: BrowserTransport): DraftsClient => {
  const write = <T>(path: string, options: WriteOptions, decode: (value: unknown) => T): Promise<T> =>
    readableWrite(transport.json(path, { ...options, body: options.body ?? {} }).then(decode))
  const draft = (path: string, options: WriteOptions) => write(path, options, decodeDraft)
  const postDraft = (csrfToken: string, body: unknown, idempotencyKey: string, signal?: AbortSignal) =>
    draft("/api/drafts", { csrfToken, method: "POST", body, idempotencyKey, ...(signal === undefined ? {} : { signal }) })
  const postInvoice = (csrfToken: string, body: unknown, idempotencyKey: string) =>
    write("/api/invoices", { csrfToken, method: "POST", body, idempotencyKey }, decodeIssuedInvoice)
  return {
    createDraft: (csrfToken, body, idempotencyKey, signal) => postDraft(csrfToken, body, idempotencyKey, signal),
    replayDraftCreation: postDraft,
    listDrafts: async (page, signal) =>
      decodeDraftPage(await transport.json(paged("/api/drafts", page), { signal })),
    getDraft: async (id, signal) =>
      decodeDraft(await transport.json(`/api/drafts/${encoded(id)}`, { signal })),
    updateDraft: (csrfToken, id, body) =>
      draft(`/api/drafts/${encoded(id)}`, { csrfToken, method: "PUT", body }),
    deleteDraft: async (csrfToken, id) => {
      await write(`/api/drafts/${encoded(id)}`, { csrfToken, method: "DELETE" }, decodeDeleted)
    },
    addDraftLine: (csrfToken, id, body) =>
      draft(`/api/drafts/${encoded(id)}/lines`, { csrfToken, method: "POST", body }),
    updateDraftLine: (csrfToken, id, lineId, body) =>
      draft(`/api/drafts/${encoded(id)}/lines/${encoded(lineId)}`, { csrfToken, method: "PUT", body }),
    deleteDraftLine: (csrfToken, id, lineId) =>
      draft(`/api/drafts/${encoded(id)}/lines/${encoded(lineId)}`, { csrfToken, method: "DELETE" }),
    issueDraft: (csrfToken, id, idempotencyKey) =>
      write(`/api/drafts/${encoded(id)}/issue`, { csrfToken, method: "POST", idempotencyKey }, decodeIssuedInvoice),
    issueInvoice: (csrfToken, body, idempotencyKey) => postInvoice(csrfToken, body, idempotencyKey),
    replayInvoiceIssuance: postInvoice,
  }
}
