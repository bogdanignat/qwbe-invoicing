import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"

import type { UseServices } from "./api-types.ts"
import { errors } from "./api-failures.ts"
import { applicationHttpApi } from "./http-api.ts"

export const customerHandlers = (use: UseServices) => ({
  listCustomers: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "listCustomers", ({ urlParams }) =>
    use((s) => s.invoicing.listCustomers(urlParams)).pipe(Effect.mapError(errors("ValidationFailure")))),
  getCustomer: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "getCustomer", ({ path }) =>
    use((s) => s.invoicing.getCustomer(path.id)).pipe(Effect.mapError(errors("ResourceNotFound")))),
  createCustomer: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "createCustomer", ({ payload }) =>
    use((s) => s.invoicing.createCustomer(payload)).pipe(Effect.mapError(errors("ValidationFailure")))),
  updateCustomer: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "updateCustomer", ({ path, payload }) =>
    use((s) => s.invoicing.updateCustomer({ id: path.id, ...payload })).pipe(Effect.mapError(errors("ValidationFailure", "ResourceNotFound")))),
  deleteCustomer: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "deleteCustomer", ({ path }) =>
    use((s) => s.invoicing.deleteCustomer(path.id)).pipe(
      Effect.as({ deleted: true } as const), Effect.mapError(errors("ResourceNotFound", "DomainConflict")))),
})
