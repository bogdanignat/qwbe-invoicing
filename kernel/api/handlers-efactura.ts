import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"

import { mapCorrection, mapIssuedInvoice } from "../efactura/efactura-mapper.ts"
import { errors } from "./api-failures.ts"
import { efacturaXml } from "./api-responses.ts"
import { createUseServices } from "./api-services.ts"
import type { ApiRuntime } from "./api-types.ts"
import { efacturaHttpApi } from "./http-api.ts"

/**
 * The e-Factura plugin's routes: the UBL XML of an invoice and of a correction.
 * `createApiHandler` mounts them only when the plugin is on, so with it off the
 * host mapper in `kernel/efactura/` is never called.
 */
export const efacturaGroup = (runtime: ApiRuntime) => {
  const use = createUseServices(runtime)
  return HttpApiBuilder.group(efacturaHttpApi, "invoicing", (handlers) => handlers
    .handleRaw("downloadInvoiceEFactura", ({ path }) => use((s) => s.invoicing.getIssuedInvoice(path.id)).pipe(
      Effect.flatMap((invoice) => efacturaXml(() => mapIssuedInvoice(invoice))),
      Effect.mapError(errors("ResourceNotFound", "ValidationFailure"))))
    .handleRaw("downloadCorrectionEFactura", ({ path }) => use((s) => Effect.flatMap(s.invoicing.getCorrection(path.id),
      (correction) => Effect.map(s.invoicing.getIssuedInvoice(correction.originalInvoiceId),
        (original) => ({ correction, original })))).pipe(
      Effect.flatMap(({ correction, original }) => efacturaXml(() => mapCorrection(correction, original))),
      Effect.mapError(errors("ResourceNotFound", "ValidationFailure")))))
}
