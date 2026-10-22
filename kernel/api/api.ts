import { createHash } from "node:crypto"

import { HttpApiBuilder, HttpServer } from "@effect/platform"
import { Effect, Layer } from "effect"

import { authenticationLayer, sessionAuthenticationLayer } from "./api-authentication.ts"
import { documentErrors } from "./api-failures.ts"
import { failureMiddleware, finalMiddleware, methodFallbackLayer } from "./api-routing.ts"
import { pdfResponse } from "./api-responses.ts"
import { createUseServices } from "./api-services.ts"
import { createAnafClient } from "../company-lookup/anaf-client.ts"
import { anafVatRegistry } from "../company-lookup/vat-registry.ts"
import { invoicingGroup } from "./api-invoicing-group.ts"
import { companyLookupGroup } from "./handlers-company-lookup.ts"
import { efacturaGroup } from "./handlers-efactura.ts"
import { paymentsGroup } from "./handlers-payments.ts"
import { sessionsGroup } from "./api-session-group.ts"
import type { ApiRuntime, UseServices } from "./api-types.ts"
import { documentHandlers } from "./handlers-documents.ts"
import { applicationHttpApi, handlerHttpApi } from "./http-api.ts"

export type { ApiRuntime } from "./api-types.ts"
export interface ApiHandler { readonly handle: (request: Request) => Promise<Response>; readonly dispose: () => Promise<void> }

const documentsGroup = (use: UseServices) => {
  const d = documentHandlers(use)
  return HttpApiBuilder.group(applicationHttpApi, "documents", (handlers) => handlers
    .handle("renderInvoicePdf", d.renderInvoicePdf)
    .handleRaw("downloadInvoicePdf", ({ path }) => use((s) => s.documents.downloadInvoice(path.invoiceId)).pipe(
      Effect.map(({ artifact, bytes }) => pdfResponse("invoice", path.invoiceId, bytes, artifact.sha256)),
      Effect.mapError(documentErrors("DocumentNotFound"))))
    .handle("renderProformaPdf", d.renderProformaPdf)
    .handleRaw("downloadProformaPdf", ({ path }) => use((s) => s.documents.downloadProforma(path.proformaId)).pipe(
      Effect.map(({ artifact, bytes }) => pdfResponse("proforma", path.proformaId, bytes, artifact.sha256)),
      Effect.mapError(documentErrors("DocumentNotFound"))))
    .handleRaw("downloadCorrectionPdf", ({ path }) => use((s) => s.documents.renderCorrection(path.id)).pipe(
      Effect.map(({ bytes }) => pdfResponse("correction", path.id, bytes, createHash("sha256").update(bytes).digest("hex"))),
      Effect.mapError(documentErrors("DocumentNotFound")))))
}

export const createApiHandler = (runtime: ApiRuntime): ApiHandler => {
  // One ANAF client per handler, so one queue for the company lookup and the issuer's VAT check.
  const anaf = runtime.plugins["company-lookup"]
    ? createAnafClient({ transport: runtime.transport ?? fetch, ...(runtime.now ? { now: runtime.now } : {}) })
    : undefined
  // One composition of the services for every group, so none can be built without the registry.
  const use = createUseServices(runtime, anaf === undefined ? undefined : anafVatRegistry(anaf))
  // A plugin that is off has no route at all: the router answers 404 for it.
  const plugins = [
    ...(runtime.plugins.payments ? [paymentsGroup(use)] : []),
    ...(runtime.plugins.efactura ? [efacturaGroup(runtime, use)] : []),
    ...(anaf === undefined ? [] : [companyLookupGroup(runtime, anaf)]),
  ]
  const groups = Layer.mergeAll(invoicingGroup(runtime, use), documentsGroup(use), sessionsGroup(runtime), ...plugins)
  const routes = methodFallbackLayer.pipe(Layer.provideMerge(groups))
  const api = HttpApiBuilder.api(handlerHttpApi).pipe(
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
