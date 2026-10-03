import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"

import { mapCorrection, mapIssuedInvoice } from "../efactura/efactura-mapper.ts"
import { errors } from "./api-failures.ts"
import { efacturaXml } from "./api-responses.ts"
import { createUseServices } from "./api-services.ts"
import type { ApiRuntime } from "./api-types.ts"
import { customerHandlers } from "./handlers-customers.ts"
import { draftHandlers } from "./handlers-drafts.ts"
import { issuanceHandlers } from "./handlers-issuance.ts"
import { masterDataHandlers } from "./handlers-master-data.ts"
import { paymentCorrectionHandlers } from "./handlers-payments-corrections.ts"
import { applicationHttpApi } from "./http-api.ts"

/**
 * The invoicing group, lifted out of `api.ts` so the composition root stays
 * readable and inside the per-file budget. It is a route table and nothing else:
 * no service is built here beyond `createUseServices`, which takes the runtime's
 * pool and builds the cube services per request.
 */
export const invoicingGroup = (runtime: ApiRuntime) => {
  const use = createUseServices(runtime)
  const m = masterDataHandlers(use)
  const c = customerHandlers(use)
  const d = draftHandlers(use)
  const p = paymentCorrectionHandlers(use)
  const i = issuanceHandlers(use)
  return HttpApiBuilder.group(applicationHttpApi, "invoicing", (handlers) => handlers
    .handle("getIssuer", m.getIssuer).handle("configureIssuer", m.configureIssuer)
    .handle("listDocumentSeries", m.listDocumentSeries).handle("addDocumentSeries", m.addDocumentSeries)
    .handle("listUnitOfMeasures", m.listUnitOfMeasures).handle("listVatRegimes", m.listVatRegimes)
    .handle("listCustomers", c.listCustomers).handle("getCustomer", c.getCustomer)
    .handle("createCustomer", c.createCustomer).handle("updateCustomer", c.updateCustomer).handle("deleteCustomer", c.deleteCustomer)
    .handle("listProductPresets", m.listProductPresets).handle("createProductPreset", m.createProductPreset)
    .handle("updateProductPreset", m.updateProductPreset).handle("deleteProductPreset", m.deleteProductPreset)
    .handle("listDrafts", d.listDrafts).handle("getDraft", d.getDraft).handle("createDraft", d.createDraft)
    .handle("updateDraft", d.updateDraft).handle("deleteDraft", d.deleteDraft).handle("addDraftLine", d.addDraftLine)
    .handle("updateDraftLine", d.updateDraftLine).handle("deleteDraftLine", d.deleteDraftLine)
    .handle("issueDraftInvoice", d.issueDraftInvoice)
    .handle("listPayments", p.listPayments).handle("recordPayment", p.recordPayment).handle("reversePayment", p.reversePayment)
    .handle("createCorrection", p.createCorrection).handle("listCorrections", p.listCorrections).handle("getCorrection", p.getCorrection)
    .handleRaw("downloadCorrectionEFactura", ({ path }) => use((s) => Effect.flatMap(s.invoicing.getCorrection(path.id),
      (correction) => Effect.map(s.invoicing.getIssuedInvoice(correction.originalInvoiceId),
        (original) => ({ correction, original })))).pipe(
      Effect.flatMap(({ correction, original }) => efacturaXml(() => mapCorrection(correction, original))),
      Effect.mapError(errors("ResourceNotFound", "ValidationFailure"))))
    .handle("listInvoiceRegister", i.listInvoiceRegister)
    .handle("listIssuedInvoices", i.listIssuedInvoices).handle("issueInvoice", i.issueInvoice)
    .handle("getIssuedInvoice", i.getIssuedInvoice)
    .handleRaw("downloadInvoiceEFactura", ({ path }) => use((s) => s.invoicing.getIssuedInvoice(path.id)).pipe(
      Effect.flatMap((invoice) => efacturaXml(() => mapIssuedInvoice(invoice))),
      Effect.mapError(errors("ResourceNotFound", "ValidationFailure"))))
    .handle("issueDraftProforma", i.issueDraftProforma).handle("listProformas", i.listProformas)
    .handle("issueProforma", i.issueProforma).handle("getProforma", i.getProforma)
    .handle("issueInvoiceFromProforma", i.issueInvoiceFromProforma)
    .handle("createDraftInvoiceFromProforma", i.createDraftInvoiceFromProforma))
}
