import type { HttpApiEndpoint, HttpApiGroup } from "@effect/platform"

import { efacturaConnectionEndpoints as e } from "./http-endpoints-efactura.ts"
import { withReconciliation } from "./http-endpoints-efactura-reconciliation.ts"
import { withSubmissions } from "./http-endpoints-efactura-submissions.ts"
import { fiscalEndpoints as f } from "./http-endpoints-fiscal.ts"

/** The e-Factura plugin's operations, in the contract's order. */
export const efacturaOperationNames = [
  "downloadInvoiceEFactura", "downloadCorrectionEFactura",
  "getEFacturaConnection", "startEFacturaConnection", "disconnectEFactura", "completeAnafCallback",
  "submitInvoiceEFactura", "submitCorrectionEFactura", "listInvoiceEFacturaSubmissions", "listCorrectionEFacturaSubmissions",
  "downloadEFacturaResponse", "downloadEFacturaSubmissionXml",
  "listEFacturaCandidates", "linkEFacturaSubmission", "resubmitEFacturaSubmission",
] as const

/** Adds every e-Factura route to the invoicing group: the XML, the connection, the submissions and their reconciliation. */
export const withEFactura = <E extends HttpApiEndpoint.HttpApiEndpoint.Any, R>(
  group: HttpApiGroup.HttpApiGroup<"invoicing", E, never, R, boolean>,
) => withReconciliation(withSubmissions(group.add(f.downloadInvoiceEFactura).add(f.downloadCorrectionEFactura)
  .add(e.getEFacturaConnection).add(e.startEFacturaConnection).add(e.disconnectEFactura).add(e.completeAnafCallback)))
