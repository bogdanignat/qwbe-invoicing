import { HttpApiEndpoint, type HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform"
import { Schema } from "effect"

import { ANAF_ENVIRONMENTS } from "../../cubes/invoicing/efactura/connection/index.ts"
import { ARCHIVE_STATES, FISCAL_STATES } from "../../cubes/invoicing/efactura/submissions/index.ts"
import { body, conflict, id, invoicingBase, notFound, validation } from "./http-api-shared.ts"
import { EFacturaXml } from "./schema-documents.ts"

/** A submission as the API shows it: never the bytes, never a token. */
export const EFacturaSubmission = Schema.Struct({
  id: Schema.String, environment: Schema.Literal(...ANAF_ENVIRONMENTS), documentKind: Schema.Literal("invoice", "correction"),
  documentId: Schema.String, standard: Schema.Literal("UBL", "CN"), cif: Schema.String,
  state: Schema.Literal(...FISCAL_STATES), archiveState: Schema.Literal(...ARCHIVE_STATES),
  uploadIndex: Schema.NullOr(Schema.String), downloadId: Schema.NullOr(Schema.String),
  errors: Schema.Array(Schema.String).annotations({
    description: "ANAF's own messages, sanitized; on a queued submission, why it waits: `neconectat` without a usable connection,"
      + " `conexiune_alt_cif` while the connection is for another CIF.",
  }),
  superseded: Schema.Boolean, xmlSha256: Schema.String, xmlSize: Schema.Int,
  createdBy: Schema.String, createdAt: Schema.String, updatedAt: Schema.String,
})
const EFacturaResubmission = Schema.Struct({
  previousId: Schema.String, nextId: Schema.String, actorId: Schema.String, createdAt: Schema.String,
}).annotations({ description: "The unknown submission `previousId` was replaced by `nextId`, on the actor's confirmation." })
export const EFacturaSubmissionHistory = Schema.Struct({
  current: Schema.NullOr(EFacturaSubmission), submissions: Schema.Array(EFacturaSubmission), resubmissions: Schema.Array(EFacturaResubmission),
})
const EFacturaResponse = HttpApiSchema.Uint8Array({ contentType: "application/zip" })

const submitDescription = [
  "Queues the document for ANAF e-Factura; the dispatcher validates, uploads and polls it. 202 with the new submission,",
  "or 200 with the document's live, unknown or accepted one. 409: e-Factura not configured or not connected, the issuer CIF",
  "is not the connection's, the buyer is a private person, or the XML is over 10 MB.",
].join(" ")

/** The submission routes of the e-Factura plugin. */
export const efacturaSubmissionEndpoints = {
  submitInvoiceEFactura: invoicingBase(conflict(notFound(validation(body(HttpApiEndpoint.post("submitInvoiceEFactura")`/invoices/${id}/efactura/submission`
    .addSuccess(EFacturaSubmission, { status: 202 }).addSuccess(EFacturaSubmission)))))).annotate(OpenApi.Description, submitDescription),
  submitCorrectionEFactura: invoicingBase(conflict(notFound(validation(body(HttpApiEndpoint.post("submitCorrectionEFactura")`/corrections/${id}/efactura/submission`
    .addSuccess(EFacturaSubmission, { status: 202 }).addSuccess(EFacturaSubmission)))))).annotate(OpenApi.Description, submitDescription),
  listInvoiceEFacturaSubmissions: invoicingBase(notFound(
    HttpApiEndpoint.get("listInvoiceEFacturaSubmissions")`/invoices/${id}/efactura/submissions`.addSuccess(EFacturaSubmissionHistory))),
  listCorrectionEFacturaSubmissions: invoicingBase(notFound(
    HttpApiEndpoint.get("listCorrectionEFacturaSubmissions")`/corrections/${id}/efactura/submissions`.addSuccess(EFacturaSubmissionHistory))),
  downloadEFacturaResponse: invoicingBase(notFound(
    HttpApiEndpoint.get("downloadEFacturaResponse")`/efactura/submissions/${id}/response`.addSuccess(EFacturaResponse))),
  downloadEFacturaSubmissionXml: invoicingBase(notFound(
    HttpApiEndpoint.get("downloadEFacturaSubmissionXml")`/efactura/submissions/${id}/xml`.addSuccess(EFacturaXml))),
} as const

/** Adds the submission routes to the e-Factura plugin's group. */
export const withSubmissions = <E extends HttpApiEndpoint.HttpApiEndpoint.Any, R>(
  group: HttpApiGroup.HttpApiGroup<"invoicing", E, never, R, boolean>,
) => {
  const t = efacturaSubmissionEndpoints
  return group.add(t.submitInvoiceEFactura).add(t.submitCorrectionEFactura).add(t.listInvoiceEFacturaSubmissions)
    .add(t.listCorrectionEFacturaSubmissions).add(t.downloadEFacturaResponse).add(t.downloadEFacturaSubmissionXml)
}
