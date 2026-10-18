import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"

import { documentErrors } from "./api-failures.ts"
import type { UseServices } from "./api-types.ts"
import { applicationHttpApi } from "./http-api.ts"

export const documentHandlers = (use: UseServices) => ({
  renderInvoicePdf: HttpApiBuilder.handler(applicationHttpApi, "documents", "renderInvoicePdf", ({ path }) =>
    use((s) => s.documents.renderInvoice(path.invoiceId)).pipe(
      Effect.mapError(documentErrors("DocumentNotFound", "ArtifactConflict")))),
  renderProformaPdf: HttpApiBuilder.handler(applicationHttpApi, "documents", "renderProformaPdf", ({ path }) =>
    use((s) => s.documents.renderProforma(path.proformaId)).pipe(
      Effect.mapError(documentErrors("DocumentNotFound", "ArtifactConflict")))),
})
