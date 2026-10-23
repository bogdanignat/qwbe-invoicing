import { HttpApiBuilder, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"

import {
  completeCallback, createConnectionService, efacturaPermissions, type ConnectionService,
} from "../../cubes/invoicing/efactura/connection/index.ts"
import { anafCallbackResponse, attemptCookie } from "../efactura/anaf/callback-http.ts"
import { ANAF_NOT_CONFIGURED, connectionHost } from "../efactura/anaf/connection-host.ts"
import { mapCorrection, mapIssuedInvoice } from "../efactura/efactura-mapper.ts"
import { CurrentRequest } from "./api-context.ts"
import { errors } from "./api-failures.ts"
import { efacturaXml } from "./api-responses.ts"
import type { ApiRuntime, UseServices } from "./api-types.ts"
import { receivedHandlers } from "./handlers-efactura-received.ts"
import { reconciliationHandlers } from "./handlers-efactura-reconciliation.ts"
import { submissionHandlers } from "./handlers-efactura-submissions.ts"
import { efacturaHttpApi } from "./http-api.ts"

/**
 * The e-Factura plugin's routes: the UBL XML of an invoice and of a correction,
 * the ANAF connection, the submissions with their history, XML and answer, the
 * reconciliation of unknown ones, and the invoices received through the SPV. `createApiHandler` mounts them only when
 * the plugin is on, so with it off neither the mapper nor ANAF is ever reached.
 */
export const efacturaGroup = (runtime: ApiRuntime, use: UseServices) => {
  const host = connectionHost(runtime.pool, runtime.anaf ?? ANAF_NOT_CONFIGURED, runtime.transport ?? fetch, runtime.now)
  const permissions = efacturaPermissions("efactura")
  const connection = <A, E>(operation: (service: ConnectionService) => Effect.Effect<A, E>) => Effect.flatMap(CurrentRequest,
    (context) => operation(createConnectionService({ ...host, context: { current: Effect.succeed(context) }, permissions })))
  const callback = completeCallback(host)
  const submissions = submissionHandlers(runtime, use)
  const reconciliation = reconciliationHandlers(runtime, use)
  const received = receivedHandlers(runtime)
  return HttpApiBuilder.group(efacturaHttpApi, "invoicing", (handlers) => handlers
    .handleRaw("downloadInvoiceEFactura", ({ path }) => use((s) => s.invoicing.getIssuedInvoice(path.id)).pipe(
      Effect.flatMap((invoice) => efacturaXml(() => mapIssuedInvoice(invoice))),
      Effect.mapError(errors("ResourceNotFound", "ValidationFailure"))))
    .handleRaw("downloadCorrectionEFactura", ({ path }) => use((s) => Effect.flatMap(s.invoicing.getCorrection(path.id),
      (correction) => Effect.map(s.invoicing.getIssuedInvoice(correction.originalInvoiceId),
        (original) => ({ correction, original })))).pipe(
      Effect.flatMap(({ correction, original }) => efacturaXml(() => mapCorrection(correction, original))),
      Effect.mapError(errors("ResourceNotFound", "ValidationFailure"))))
    .handle("getEFacturaConnection", () => connection((s) => s.status).pipe(Effect.mapError(errors())))
    .handleRaw("startEFacturaConnection", () => connection((s) => s.start).pipe(
      Effect.map(({ authorizeUrl, nonce }) => HttpServerResponse.unsafeJson({ authorizeUrl }, { headers: { "set-cookie": attemptCookie(nonce) } })),
      Effect.mapError(errors("DomainConflict"))))
    .handle("disconnectEFactura", () => connection((s) => s.disconnect).pipe(Effect.mapError(errors())))
    .handleRaw("completeAnafCallback", ({ request }) => anafCallbackResponse(callback, request))
    .handleRaw("submitInvoiceEFactura", submissions.submitInvoice)
    .handleRaw("submitCorrectionEFactura", submissions.submitCorrection)
    .handle("listInvoiceEFacturaSubmissions", submissions.listInvoice)
    .handle("listCorrectionEFacturaSubmissions", submissions.listCorrection)
    .handleRaw("downloadEFacturaResponse", submissions.response)
    .handleRaw("downloadEFacturaSubmissionXml", submissions.xml)
    .handle("listEFacturaCandidates", reconciliation.candidates)
    .handle("linkEFacturaSubmission", reconciliation.link)
    .handle("resubmitEFacturaSubmission", reconciliation.resubmit)
    .handle("requestEFacturaReceivedFetch", received.requestFetch)
    .handle("getEFacturaReceivedStatus", received.status)
    .handle("listEFacturaReceived", received.list)
    .handle("getEFacturaReceived", received.detail)
    .handleRaw("downloadEFacturaReceivedArchive", received.archive))
}
