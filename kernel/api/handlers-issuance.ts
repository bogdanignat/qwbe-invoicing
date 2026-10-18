import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"

import { errors } from "./api-failures.ts"
import { idempotent, sourceFilter } from "./api-operation-inputs.ts"
import type { UseServices } from "./api-types.ts"
import { applicationHttpApi } from "./http-api.ts"

export const issuanceHandlers = (use: UseServices) => ({
  listInvoiceRegister: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "listInvoiceRegister", ({ urlParams }) =>
    sourceFilter(urlParams).pipe(Effect.flatMap((source) => use((s) => s.invoicing.listInvoiceRegister(source, urlParams))),
      Effect.mapError(errors("ValidationFailure")))),
  listIssuedInvoices: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "listIssuedInvoices", ({ urlParams }) =>
    sourceFilter(urlParams).pipe(Effect.flatMap((source) => use((s) => s.invoicing.listIssuedInvoices(source, urlParams))),
      Effect.mapError(errors("ValidationFailure")))),
  issueInvoice: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "issueInvoice", ({ payload, headers }) =>
    idempotent(headers["idempotency-key"], "issue_invoice_direct", payload).pipe(
      Effect.flatMap((input) => use((s) => s.invoicing.issueInvoice(input))),
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))),
  getIssuedInvoice: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "getIssuedInvoice", ({ path }) =>
    use((s) => s.invoicing.getIssuedInvoice(path.id)).pipe(Effect.mapError(errors("ResourceNotFound")))),
  issueDraftProforma: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "issueDraftProforma", ({ path, payload, headers }) =>
    idempotent(headers["idempotency-key"], "issue_proforma_from_draft", { draftId: path.draftId, ...payload }).pipe(
      Effect.flatMap((input) => use((s) => s.invoicing.issueProforma(input))),
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))),
  listProformas: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "listProformas", ({ urlParams }) =>
    sourceFilter(urlParams).pipe(Effect.flatMap((source) => use((s) => s.invoicing.listProformas(source, urlParams))),
      Effect.mapError(errors("ValidationFailure")))),
  issueProforma: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "issueProforma", ({ payload, headers }) =>
    idempotent(headers["idempotency-key"], "issue_proforma_direct", payload).pipe(
      Effect.flatMap((input) => use((s) => s.invoicing.issueProforma(input))),
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))),
  getProforma: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "getProforma", ({ path }) =>
    use((s) => s.invoicing.getProforma(path.id)).pipe(Effect.mapError(errors("ResourceNotFound")))),
  issueInvoiceFromProforma: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "issueInvoiceFromProforma", ({ path, payload, headers }) =>
    idempotent(headers["idempotency-key"], "issue_invoice_from_proforma", { proformaId: path.id, ...payload }).pipe(
      Effect.flatMap((input) => use((s) => s.invoicing.issueInvoiceFromProforma(input))),
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))),
  createDraftInvoiceFromProforma: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "createDraftInvoiceFromProforma", ({ path, payload, headers }) =>
    idempotent(headers["idempotency-key"], "create_draft_invoice_from_proforma", { proformaId: path.id, ...payload }).pipe(
      Effect.flatMap((input) => use((s) => s.invoicing.createDraftInvoiceFromProforma(input))),
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))),
})
