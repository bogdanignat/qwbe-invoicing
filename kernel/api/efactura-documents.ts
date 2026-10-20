import { Effect } from "effect"

import type { CorrectionDocument } from "../../cubes/invoicing/corrections/index.ts"
import type { IssuedInvoice } from "../../cubes/invoicing/index.ts"
import type { SubmissionDocument, SubmittedKind } from "../../cubes/invoicing/efactura/submissions/index.ts"
import { mapCorrection, mapIssuedInvoice } from "../efactura/efactura-mapper.ts"
import { renderEFactura } from "./api-responses.ts"
import { createUseServices } from "./api-services.ts"
import type { ApiRuntime } from "./api-types.ts"

const xmlOf = (build: Parameters<typeof renderEFactura>[0]) => Effect.map(renderEFactura(build), ({ bytes }) => bytes)

const invoiceDocument = (invoice: IssuedInvoice): SubmissionDocument => ({
  kind: "invoice", id: invoice.id, issuerFiscalIdentifier: invoice.issuer.fiscalIdentifier,
  buyerIsIndividual: invoice.customer.partyType === "individual", xml: xmlOf(() => mapIssuedInvoice(invoice)),
})

const correctionDocument = (correction: CorrectionDocument, original: IssuedInvoice): SubmissionDocument => ({
  kind: "correction", id: correction.id, issuerFiscalIdentifier: correction.issuer.fiscalIdentifier,
  buyerIsIndividual: correction.customer.partyType === "individual", xml: xmlOf(() => mapCorrection(correction, original)),
})

/**
 * An issued invoice or correction as e-Factura submits it, loaded from its
 * frozen snapshot under the invoicing grants: a proforma, or anything that is
 * not an issued document, is not found. The XML is generated only when asked.
 */
export const efacturaDocuments = (runtime: ApiRuntime) => {
  const use = createUseServices(runtime)
  const invoice = (id: string) => use((s) => Effect.map(s.invoicing.getIssuedInvoice(id), invoiceDocument))
  const correction = (id: string) => use((s) => Effect.flatMap(s.invoicing.getCorrection(id),
    (found) => Effect.map(s.invoicing.getIssuedInvoice(found.originalInvoiceId), (original) => correctionDocument(found, original))))
  return { invoice, correction, load: (kind: SubmittedKind, id: string) => kind === "invoice" ? invoice(id) : correction(id) }
}
