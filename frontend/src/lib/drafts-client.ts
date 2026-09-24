import { decodeDeleted, decodeDraft, decodeDraftPage } from "./draft-decoders.ts"
import { decodeIssuedInvoice } from "./document-snapshot-decoders.ts"
import { encoded, paged } from "./client-paths.ts"
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
 * own — and the two issuance calls add the idempotency key the server replays
 * a lost answer by. Draft and line writes carry no key because the server
 * offers them none: they are not safely repeatable, which is why the save
 * controller reconciles before resuming one.
 */
export interface DraftsClient {
  readonly createDraft: (csrfToken: string, body: CreateDraftInput) => Promise<DraftInvoice>
  readonly listDrafts: (page: PageRequest | undefined, signal: AbortSignal) => Promise<Page<DraftInvoice>>
  readonly getDraft: (id: string, signal: AbortSignal) => Promise<DraftInvoice>
  readonly updateDraft: (csrfToken: string, id: string, body: UpdateDraftInput) => Promise<DraftInvoice>
  readonly deleteDraft: (csrfToken: string, id: string) => Promise<void>
  readonly addDraftLine: (csrfToken: string, id: string, body: DraftLineInput) => Promise<DraftInvoice>
  readonly updateDraftLine: (csrfToken: string, id: string, lineId: string, body: DraftLineInput) => Promise<DraftInvoice>
  readonly deleteDraftLine: (csrfToken: string, id: string, lineId: string) => Promise<DraftInvoice>
  readonly issueDraft: (csrfToken: string, id: string, idempotencyKey: string) => Promise<IssuedInvoice>
  readonly issueInvoice: (csrfToken: string, body: AuthoringDocumentInput, idempotencyKey: string) => Promise<IssuedInvoice>
}

export const createDraftsClient = (transport: BrowserTransport): DraftsClient => {
  const draft = (path: string, options: { readonly csrfToken: string; readonly method: "POST" | "PUT" | "DELETE"; readonly body?: unknown }) =>
    decodeDraftPromise(transport.json(path, { ...options, body: options.body ?? {} }))
  return {
    createDraft: (csrfToken, body) => draft("/api/drafts", { csrfToken, method: "POST", body }),
    listDrafts: async (page, signal) =>
      decodeDraftPage(await transport.json(paged("/api/drafts", page), { signal })),
    getDraft: async (id, signal) =>
      decodeDraft(await transport.json(`/api/drafts/${encoded(id)}`, { signal })),
    updateDraft: (csrfToken, id, body) =>
      draft(`/api/drafts/${encoded(id)}`, { csrfToken, method: "PUT", body }),
    deleteDraft: async (csrfToken, id) => {
      decodeDeleted(await transport.json(`/api/drafts/${encoded(id)}`, { csrfToken, method: "DELETE", body: {} }))
    },
    addDraftLine: (csrfToken, id, body) =>
      draft(`/api/drafts/${encoded(id)}/lines`, { csrfToken, method: "POST", body }),
    updateDraftLine: (csrfToken, id, lineId, body) =>
      draft(`/api/drafts/${encoded(id)}/lines/${encoded(lineId)}`, { csrfToken, method: "PUT", body }),
    deleteDraftLine: (csrfToken, id, lineId) =>
      draft(`/api/drafts/${encoded(id)}/lines/${encoded(lineId)}`, { csrfToken, method: "DELETE" }),
    issueDraft: async (csrfToken, id, idempotencyKey) =>
      decodeIssuedInvoice(await transport.json(`/api/drafts/${encoded(id)}/issue`, {
        csrfToken, method: "POST", body: {}, idempotencyKey,
      })),
    issueInvoice: async (csrfToken, body, idempotencyKey) =>
      decodeIssuedInvoice(await transport.json("/api/invoices", {
        csrfToken, method: "POST", body, idempotencyKey,
      })),
  }
}

const decodeDraftPromise = (input: Promise<unknown>): Promise<DraftInvoice> =>
  input.then((value) => decodeDraft(value))
