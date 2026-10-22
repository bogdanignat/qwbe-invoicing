import { HttpApiBuilder } from "@effect/platform"

import type { ApiRuntime, UseServices } from "./api-types.ts"
import { eFacturaStatusView } from "./efactura-status.ts"
import { correctionHandlers } from "./handlers-corrections.ts"
import { customerHandlers } from "./handlers-customers.ts"
import { draftHandlers } from "./handlers-drafts.ts"
import { issuanceHandlers } from "./handlers-issuance.ts"
import { masterDataHandlers } from "./handlers-master-data.ts"
import { applicationHttpApi } from "./http-api.ts"

/**
 * The invoicing group, lifted out of `api.ts` so the composition root stays
 * readable and inside the per-file budget. It is a route table and nothing else:
 * no service is built here: `use` is `createApiHandler`'s one composition of the
 * cube services, built per request. The plugins' routes are not
 * here: `handlers-payments.ts` and `handlers-efactura.ts` own them.
 */
export const invoicingGroup = (runtime: ApiRuntime, use: UseServices) => {
  const m = masterDataHandlers(use)
  const c = customerHandlers(use)
  const status = eFacturaStatusView(runtime.plugins.efactura)
  const d = draftHandlers(use, status)
  const p = correctionHandlers(use)
  const i = issuanceHandlers(use, status)
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
    .handle("createCorrection", p.createCorrection).handle("listCorrections", p.listCorrections).handle("getCorrection", p.getCorrection)
    .handle("listInvoiceRegister", i.listInvoiceRegister).handle("getRevenueReport", p.getRevenueReport)
    .handle("listIssuedInvoices", i.listIssuedInvoices).handle("issueInvoice", i.issueInvoice)
    .handle("getIssuedInvoice", i.getIssuedInvoice)
    .handle("issueDraftProforma", i.issueDraftProforma).handle("listProformas", i.listProformas)
    .handle("issueProforma", i.issueProforma).handle("getProforma", i.getProforma)
    .handle("issueInvoiceFromProforma", i.issueInvoiceFromProforma)
    .handle("createDraftInvoiceFromProforma", i.createDraftInvoiceFromProforma))
}
