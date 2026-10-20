import { HttpApiEndpoint, type HttpApiGroup, OpenApi } from "@effect/platform"
import { Schema } from "effect"

import { MAX_LINK_PAGES, MAX_WINDOW_DAYS } from "../../cubes/invoicing/efactura/reconciliation/index.ts"
import { EFacturaSubmission } from "./http-endpoints-efactura-submissions.ts"
import { body, conflict, id, invoicingBase, notFound, validation } from "./http-api-shared.ts"
import { bodyObject, optional } from "./schema-primitives.ts"

const Page = Schema.String.pipe(
  Schema.pattern(/^[1-9][0-9]{0,3}$/u, { message: () => "page must be an integer from 1" }),
  Schema.transform(Schema.Number, { strict: true, decode: Number, encode: String }),
).annotations({ description: "1-based page of ANAF's list, default 1." })
export const CandidatesQuery = Schema.Struct({ page: optional(Page) })

export const EFacturaCandidates = Schema.Struct({
  page: Schema.Int, pages: Schema.Int, from: Schema.String, to: Schema.String,
  candidates: Schema.Array(Schema.Struct({
    uploadIndex: Schema.String, createdAt: Schema.String, type: Schema.String,
    linked: Schema.Boolean.annotations({ description: "Another submission already holds this index; it cannot be linked." }),
  })),
})
const Confirmed = Schema.Boolean.annotations({ description: "Must be `true`: your explicit confirmation." })
export const LinkInput = Schema.Struct({ uploadIndex: Schema.String, confirmed: Confirmed }).annotations(bodyObject)
export const ResubmitInput = Schema.Struct({ confirmed: Confirmed }).annotations(bodyObject)

const refusals = "409: not a current unknown submission, e-Factura not configured or not connected, the connection is for another CIF,"
  + " the connection is being refreshed (`efactura_connection_refreshing`, retry), or ANAF's call budget is spent."
const candidatesDescription = [
  `What ANAF lists for the submission's CIF from the moment it was created, at most ${String(MAX_WINDOW_DAYS)} days: this CIF's own`,
  "uploads only (index, ANAF's date, type, and whether another submission already holds it), one page per call. Nothing is linked.",
  refusals,
].join(" ")
const linkDescription = [
  "Links the unknown submission to an upload index you confirm is this document. The server first finds the index in ANAF's own",
  `list for the submission's CIF and window (at most ${String(MAX_LINK_PAGES)} pages); then the submission goes to processing and the`,
  "dispatcher polls it.", refusals, "Also 409 when ANAF does not list the index or another submission holds it.",
].join(" ")
const resubmitDescription = [
  "Queues a new submission in place of the unknown one, from the same frozen snapshot, on your confirmation that ANAF's list proves",
  "nothing and that ANAF may end up holding the document twice. The old one stays unknown, marked superseded. 202 with the new",
  "submission; 200 with the one an earlier or concurrent resubmit already made.", refusals,
].join(" ")

/** The reconciliation routes of the e-Factura plugin. */
export const efacturaReconciliationEndpoints = {
  listEFacturaCandidates: invoicingBase(conflict(notFound(validation(
    HttpApiEndpoint.get("listEFacturaCandidates")`/efactura/submissions/${id}/candidates`.setUrlParams(CandidatesQuery)
      .addSuccess(EFacturaCandidates))))).annotate(OpenApi.Description, candidatesDescription),
  linkEFacturaSubmission: invoicingBase(conflict(notFound(validation(body(
    HttpApiEndpoint.post("linkEFacturaSubmission")`/efactura/submissions/${id}/link`.setPayload(LinkInput)
      .addSuccess(EFacturaSubmission)))))).annotate(OpenApi.Description, linkDescription),
  resubmitEFacturaSubmission: invoicingBase(conflict(notFound(validation(body(
    HttpApiEndpoint.post("resubmitEFacturaSubmission")`/efactura/submissions/${id}/resubmit`.setPayload(ResubmitInput)
      .addSuccess(EFacturaSubmission, { status: 202 }).addSuccess(EFacturaSubmission)))))).annotate(OpenApi.Description, resubmitDescription),
} as const

/** Adds the reconciliation routes to the e-Factura plugin's group. */
export const withReconciliation = <E extends HttpApiEndpoint.HttpApiEndpoint.Any, R>(
  group: HttpApiGroup.HttpApiGroup<"invoicing", E, never, R, boolean>,
) => {
  const t = efacturaReconciliationEndpoints
  return group.add(t.listEFacturaCandidates).add(t.linkEFacturaSubmission).add(t.resubmitEFacturaSubmission)
}
