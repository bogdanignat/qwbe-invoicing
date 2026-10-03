import { HttpApiBuilder, HttpServer } from "@effect/platform"
import { Effect, Layer } from "effect"

import { authenticationLayer, sessionAuthenticationLayer } from "./api-authentication.ts"
import { documentErrors } from "./api-failures.ts"
import { failureMiddleware, finalMiddleware, methodFallbackLayer } from "./api-routing.ts"
import { pdfResponse } from "./api-responses.ts"
import { createUseServices } from "./api-services.ts"
import { invoicingGroup } from "./api-invoicing-group.ts"
import { sessionsGroup } from "./api-session-group.ts"
import type { ApiRuntime } from "./api-types.ts"
import { documentHandlers } from "./handlers-documents.ts"
import { applicationHttpApi } from "./http-api.ts"

export type { ApiRuntime } from "./api-types.ts"
export interface ApiHandler { readonly handle: (request: Request) => Promise<Response>; readonly dispose: () => Promise<void> }

const documentsGroup = (runtime: ApiRuntime) => {
  const use = createUseServices(runtime)
  const d = documentHandlers(use)
  return HttpApiBuilder.group(applicationHttpApi, "documents", (handlers) => handlers
    .handle("renderInvoicePdf", d.renderInvoicePdf)
    .handleRaw("downloadInvoicePdf", ({ path }) => use((s) => s.documents.downloadInvoice(path.invoiceId)).pipe(
      Effect.map(({ artifact, bytes }) => pdfResponse("invoice", path.invoiceId, bytes, artifact.sha256)),
      Effect.mapError(documentErrors("DocumentNotFound"))))
    .handle("renderProformaPdf", d.renderProformaPdf)
    .handleRaw("downloadProformaPdf", ({ path }) => use((s) => s.documents.downloadProforma(path.proformaId)).pipe(
      Effect.map(({ artifact, bytes }) => pdfResponse("proforma", path.proformaId, bytes, artifact.sha256)),
      Effect.mapError(documentErrors("DocumentNotFound")))))
}

export const createApiHandler = (runtime: ApiRuntime): ApiHandler => {
  const groups = Layer.mergeAll(invoicingGroup(runtime), documentsGroup(runtime), sessionsGroup(runtime))
  const routes = methodFallbackLayer.pipe(Layer.provideMerge(groups))
  const api = HttpApiBuilder.api(applicationHttpApi).pipe(
    Layer.provide(routes), Layer.provide(authenticationLayer(runtime)), Layer.provide(sessionAuthenticationLayer(runtime)),
  )
  const layer = Layer.mergeAll(api, failureMiddleware.pipe(Layer.provide(HttpApiBuilder.Middleware.layer)), HttpServer.layerContext)
  const web = HttpApiBuilder.toWebHandler(layer, { middleware: finalMiddleware })
  // Memoised: a signal handler, the server's `close` event and an explicit
  // `close()` can all reach it, and the second call must not be a failure.
  // The pool is NOT ended here — the runtime that created it owns it.
  let disposing: Promise<void> | undefined
  return { handle: web.handler, dispose: () => disposing ??= web.dispose() }
}
