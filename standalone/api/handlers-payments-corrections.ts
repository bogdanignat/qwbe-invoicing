import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"

import { errors } from "./api-failures.ts"
import { idempotent, sourceFilter } from "./api-operation-inputs.ts"
import type { UseServices } from "./api-types.ts"
import { applicationHttpApi } from "./http-api.ts"

export const paymentCorrectionHandlers = (use: UseServices) => ({
  listPayments: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "listPayments", ({ path }) =>
    use((s) => s.payments.listPayments(path.invoiceId)).pipe(Effect.mapError(errors("ResourceNotFound")))),
  recordPayment: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "recordPayment", ({ path, payload, headers }) =>
    idempotent(headers["idempotency-key"], "record_payment", { invoiceId: path.invoiceId, ...payload }).pipe(
      Effect.flatMap((input) => use((s) => s.payments.recordPayment(input))),
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))),
  reversePayment: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "reversePayment", ({ path, payload, headers }) =>
    idempotent(headers["idempotency-key"], "reverse_payment", { invoiceId: path.invoiceId, paymentId: path.paymentId, ...payload }).pipe(
      Effect.flatMap((input) => use((s) => s.payments.reversePayment(input))),
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))),
  createCorrection: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "createCorrection", ({ path, payload, headers }) =>
    idempotent(headers["idempotency-key"], "create_correction", { originalInvoiceId: path.invoiceId, ...payload }).pipe(
      Effect.flatMap((input) => use((s) => s.invoicing.createCorrection(input))),
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))),
  listCorrections: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "listCorrections", ({ path, urlParams }) =>
    sourceFilter(urlParams).pipe(Effect.flatMap((source) => use((s) => s.invoicing.listCorrections(path.invoiceId, source))),
      Effect.mapError(errors("ValidationFailure")))),
  getCorrection: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "getCorrection", ({ path }) =>
    use((s) => s.invoicing.getCorrection(path.id)).pipe(Effect.mapError(errors("ResourceNotFound")))),
})
