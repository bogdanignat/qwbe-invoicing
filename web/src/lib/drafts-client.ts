import { apiRequest } from "./api-transport.ts"
import { encoded, paged } from "./client-paths.ts"
import { decodeDeleted, decodeDraft, decodeDraftPage, decodeInvoice, type PageRequest } from "./models.ts"
import type { CreateDraftInput, DraftLineInput, UpdateDraftInput } from "./invoicing-client-types.ts"

export const draftsClient = {
  createDraft: (body: CreateDraftInput, idempotencyKey: string) =>
    apiRequest("/api/drafts", decodeDraft, { method: "POST", body, idempotencyKey }),
  listDrafts: (page?: PageRequest) => apiRequest(paged("/api/drafts", page), decodeDraftPage),
  getDraft: (id: string) => apiRequest(`/api/drafts/${encoded(id)}`, decodeDraft),
  updateDraft: (id: string, body: UpdateDraftInput) =>
    apiRequest(`/api/drafts/${encoded(id)}`, decodeDraft, { method: "PUT", body }),
  deleteDraft: (id: string) =>
    apiRequest(`/api/drafts/${encoded(id)}`, decodeDeleted, { method: "DELETE" }),
  addDraftLine: (id: string, body: DraftLineInput) =>
    apiRequest(`/api/drafts/${encoded(id)}/lines`, decodeDraft, { method: "POST", body }),
  updateDraftLine: (id: string, lineId: string, body: DraftLineInput) =>
    apiRequest(`/api/drafts/${encoded(id)}/lines/${encoded(lineId)}`, decodeDraft, {
      method: "PUT", body,
    }),
  deleteDraftLine: (id: string, lineId: string) =>
    apiRequest(`/api/drafts/${encoded(id)}/lines/${encoded(lineId)}`, decodeDraft, {
      method: "DELETE",
    }),
  issueDraft: (id: string, idempotencyKey: string) =>
    apiRequest(`/api/drafts/${encoded(id)}/issue`, decodeInvoice, {
      method: "POST", body: {}, idempotencyKey,
    }),
} as const
