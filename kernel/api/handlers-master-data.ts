import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"

import { issuerSaveConflicts } from "../../cubes/invoicing/issuer/index.ts"
import type { UseServices } from "./api-types.ts"
import { errors, type ApiFailure } from "./api-failures.ts"
import { applicationHttpApi } from "./http-api.ts"

const deleted = { deleted: true } as const
const issuerConflicts: ReadonlyArray<string> = Object.values(issuerSaveConflicts)
// Only the issuer's own conflicts are answers: one the store raises on this write (a drifted schema) stays a logged 500.
const issuerErrors = (failure: ApiFailure) =>
  failure._tag === "DomainConflict" && !issuerConflicts.includes(failure.code)
    ? errors("ValidationFailure", "vat_registry_unavailable")(failure)
    : errors("ValidationFailure", "DomainConflict", "vat_registry_unavailable")(failure)
export const masterDataHandlers = (use: UseServices) => ({
  getIssuer: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "getIssuer", () =>
    use((s) => s.invoicing.getIssuer()).pipe(Effect.mapError(errors("ResourceNotFound")))),
  configureIssuer: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "configureIssuer", ({ payload }) =>
    use((s) => s.invoicing.configureIssuer(payload)).pipe(Effect.mapError(issuerErrors))),
  listDocumentSeries: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "listDocumentSeries", () =>
    use((s) => s.invoicing.listDocumentSeries()).pipe(Effect.mapError(errors()))),
  addDocumentSeries: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "addDocumentSeries", ({ payload }) =>
    use((s) => s.invoicing.addDocumentSeries(payload)).pipe(Effect.mapError(errors("ValidationFailure", "DomainConflict")))),
  listUnitOfMeasures: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "listUnitOfMeasures", () =>
    use((s) => s.invoicing.listUnitOfMeasures()).pipe(Effect.mapError(errors()))),
  listVatRegimes: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "listVatRegimes", () =>
    use((s) => s.invoicing.getVatCatalogue()).pipe(Effect.mapError(errors("ValidationFailure")))),
  listProductPresets: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "listProductPresets", ({ urlParams }) =>
    use((s) => s.invoicing.listProductPresets(urlParams)).pipe(Effect.mapError(errors("ValidationFailure")))),
  createProductPreset: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "createProductPreset", ({ payload }) =>
    use((s) => s.invoicing.createProductPreset(payload)).pipe(Effect.mapError(errors("ValidationFailure")))),
  updateProductPreset: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "updateProductPreset", ({ path, payload }) =>
    use((s) => s.invoicing.updateProductPreset({ id: path.id, ...payload })).pipe(Effect.mapError(errors("ValidationFailure", "ResourceNotFound")))),
  deleteProductPreset: HttpApiBuilder.handler(applicationHttpApi, "invoicing", "deleteProductPreset", ({ path }) =>
    use((s) => s.invoicing.deleteProductPreset(path.id)).pipe(Effect.as(deleted), Effect.mapError(errors("ResourceNotFound")))),
})
