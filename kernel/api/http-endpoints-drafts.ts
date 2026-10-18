import { HttpApiEndpoint } from "@effect/platform"

import * as D from "./schema-drafts.ts"
import { Deleted } from "./schema-errors-session.ts"
import { ListQuery } from "./schema-primitives.ts"
import { body, conflict, draftId, id, idempotentBody, invoicingBase, lineId, notFound, validation } from "./http-api-shared.ts"
import { IssuedInvoice } from "./schema-issuance.ts"

export const draftEndpoints = {
  listDrafts: invoicingBase(validation(HttpApiEndpoint.get("listDrafts", "/drafts").setUrlParams(ListQuery).addSuccess(D.DraftInvoicePage))),
  getDraft: invoicingBase(notFound(HttpApiEndpoint.get("getDraft")`/drafts/${id}`.addSuccess(D.DraftInvoice))),
  createDraft: invoicingBase(conflict(notFound(validation(idempotentBody(HttpApiEndpoint.post("createDraft", "/drafts").setPayload(D.DraftInput).addSuccess(D.DraftInvoice)))))),
  updateDraft: invoicingBase(conflict(notFound(validation(body(HttpApiEndpoint.put("updateDraft")`/drafts/${id}`.setPayload(D.UpdateDraftInput).addSuccess(D.DraftInvoice)))))),
  deleteDraft: invoicingBase(conflict(notFound(body(HttpApiEndpoint.del("deleteDraft")`/drafts/${id}`.addSuccess(Deleted))))),
  addDraftLine: invoicingBase(conflict(notFound(validation(body(HttpApiEndpoint.post("addDraftLine")`/drafts/${draftId}/lines`.setPayload(D.DraftLineInput).addSuccess(D.DraftInvoice)))))),
  updateDraftLine: invoicingBase(conflict(notFound(validation(body(HttpApiEndpoint.put("updateDraftLine")`/drafts/${draftId}/lines/${lineId}`.setPayload(D.DraftLineInput).addSuccess(D.DraftInvoice)))))),
  deleteDraftLine: invoicingBase(conflict(notFound(body(HttpApiEndpoint.del("deleteDraftLine")`/drafts/${draftId}/lines/${lineId}`.addSuccess(D.DraftInvoice))))),
  issueDraftInvoice: invoicingBase(conflict(notFound(validation(idempotentBody(HttpApiEndpoint.post("issueDraftInvoice")`/drafts/${draftId}/issue`.addSuccess(IssuedInvoice)))))),
} as const
