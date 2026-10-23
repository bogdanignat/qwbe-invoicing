import { HttpApiEndpoint, type HttpApiGroup, OpenApi } from "@effect/platform"

import { body, conflict, id, invoicingBase, notFound, validation } from "./http-api-shared.ts"
import {
  EFacturaReceivedArchive, EFacturaReceivedDetail, EFacturaReceivedFetch, EFacturaReceivedStatus, EFacturaReceivedSummary,
} from "./schema-efactura-received.ts"
import { PageQuery, pageOf } from "./schema-primitives.ts"

const fetchDescription = [
  "Asks for the organization's received invoices from the SPV: the dispatcher lists and downloads them in the background, and",
  "`GET /api/efactura/received/status` follows it. 202 with the new fetch, or with the one already active (asking again is safe).",
  "409: e-Factura not configured or not connected, or the connection is for another CIF than the issuer's.",
].join(" ")

/** The received-invoice routes of the e-Factura plugin; all in the current ANAF environment, of the request's organization. */
export const efacturaReceivedEndpoints = {
  requestEFacturaReceivedFetch: invoicingBase(conflict(body(HttpApiEndpoint.post("requestEFacturaReceivedFetch", "/efactura/received/fetches")
    .addSuccess(EFacturaReceivedFetch, { status: 202 })))).annotate(OpenApi.Description, fetchDescription),
  getEFacturaReceivedStatus: invoicingBase(HttpApiEndpoint.get("getEFacturaReceivedStatus", "/efactura/received/status")
    .addSuccess(EFacturaReceivedStatus)).annotate(OpenApi.Description, "The latest fetch and the coverage; the page polls it."),
  listEFacturaReceived: invoicingBase(validation(HttpApiEndpoint.get("listEFacturaReceived", "/efactura/received").setUrlParams(PageQuery)
    .addSuccess(pageOf(EFacturaReceivedSummary)))).annotate(OpenApi.Description, "Received invoices, newest first in the SPV."),
  getEFacturaReceived: invoicingBase(notFound(HttpApiEndpoint.get("getEFacturaReceived")`/efactura/received/${id}`
    .addSuccess(EFacturaReceivedDetail))),
  downloadEFacturaReceivedArchive: invoicingBase(notFound(HttpApiEndpoint.get("downloadEFacturaReceivedArchive")`/efactura/received/${id}/archive`
    .addSuccess(EFacturaReceivedArchive))).annotate(OpenApi.Description, "ANAF's ZIP exactly as it came, read or not."),
} as const

/** Adds the received-invoice routes to the e-Factura plugin's group. */
export const withReceived = <E extends HttpApiEndpoint.HttpApiEndpoint.Any, R>(
  group: HttpApiGroup.HttpApiGroup<"invoicing", E, never, R, boolean>,
) => {
  const t = efacturaReceivedEndpoints
  return group.add(t.requestEFacturaReceivedFetch).add(t.getEFacturaReceivedStatus).add(t.listEFacturaReceived).add(t.getEFacturaReceived)
    .add(t.downloadEFacturaReceivedArchive)
}
