import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"

import { errors } from "./api-failures.ts"
import { idempotent } from "./api-operation-inputs.ts"
import { activePayments } from "./api-services.ts"
import type { UseServices } from "./api-types.ts"
import { paymentsHttpApi } from "./http-api.ts"

/** The payments plugin's routes. `createApiHandler` mounts them only when the plugin is on. */
export const paymentsGroup = (use: UseServices) => {
  return HttpApiBuilder.group(paymentsHttpApi, "invoicing", (handlers) => handlers
    .handle("listPayments", ({ path }) => use((s) => activePayments(s).listPayments(path.invoiceId)).pipe(
      Effect.mapError(errors("ResourceNotFound"))))
    .handle("recordPayment", ({ path, payload, headers }) =>
      idempotent(headers["idempotency-key"], "record_payment", { invoiceId: path.invoiceId, ...payload }).pipe(
        Effect.flatMap((input) => use((s) => activePayments(s).recordPayment(input))),
        Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict"))))
    .handle("reversePayment", ({ path, payload, headers }) =>
      idempotent(headers["idempotency-key"], "reverse_payment", { invoiceId: path.invoiceId, paymentId: path.paymentId, ...payload }).pipe(
        Effect.flatMap((input) => use((s) => activePayments(s).reversePayment(input))),
        Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict"))))
    .handle("getCollectionsReport", ({ urlParams }) =>
      use((s) => activePayments(s).getCollectionsReport({ ...urlParams, status: urlParams.status ?? "all" })).pipe(
        Effect.mapError(errors("ValidationFailure")))))
}
