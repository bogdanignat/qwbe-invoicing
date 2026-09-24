import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"

import { errors } from "./api-failures.ts"
import { idempotent, sourceFilter } from "./api-operation-inputs.ts"
import type { UseServices } from "./api-types.ts"
import { applicationHttpApi } from "./http-api.ts"

const deleted = { deleted: true } as const
export const draftHandlers = (use: UseServices) => ({
  listDrafts: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "listDrafts", ({ urlParams }) =>
    sourceFilter(urlParams).pipe(Effect.flatMap((source) => use((s) => s.invoicing.listDrafts(source, urlParams))),
      Effect.mapError(errors("ValidationFailure")))),
  getDraft: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "getDraft", ({ path }) =>
    use((s) => s.invoicing.getDraft(path.id)).pipe(Effect.mapError(errors("ResourceNotFound")))),
  createDraft: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "createDraft", ({ payload, headers }) =>
    idempotent(headers["idempotency-key"], "create_draft", payload).pipe(
      Effect.flatMap((input) => use((s) => s.invoicing.createDraft(input))),
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))),
  updateDraft: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "updateDraft", ({ path, payload }) =>
    use((s) => s.invoicing.updateDraft({ draftId: path.id, ...payload })).pipe(
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))),
  deleteDraft: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "deleteDraft", ({ path }) =>
    use((s) => s.invoicing.deleteDraft(path.id)).pipe(Effect.as(deleted), Effect.mapError(errors("ResourceNotFound", "DomainConflict")))),
  addDraftLine: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "addDraftLine", ({ path, payload }) =>
    use((s) => s.invoicing.addDraftLine({ draftId: path.draftId, ...payload })).pipe(
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))),
  updateDraftLine: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "updateDraftLine", ({ path, payload }) =>
    use((s) => s.invoicing.updateDraftLine({ draftId: path.draftId, lineId: path.lineId, ...payload })).pipe(
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))),
  deleteDraftLine: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "deleteDraftLine", ({ path }) =>
    use((s) => s.invoicing.deleteDraftLine(path.draftId, path.lineId)).pipe(
      Effect.mapError(errors("ResourceNotFound", "DomainConflict")))),
  issueDraftInvoice: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "issueDraftInvoice", ({ path, headers }) =>
    idempotent(headers["idempotency-key"], "issue_invoice_from_draft", { draftId: path.draftId }).pipe(
      Effect.flatMap((input) => use((s) => s.invoicing.issueInvoice(input))),
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))),
})
