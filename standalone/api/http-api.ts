import { HttpApi, HttpApiGroup, OpenApi } from "@effect/platform"

import { draftEndpoints as d } from "./http-endpoints-drafts.ts"
import { fiscalEndpoints as f } from "./http-endpoints-fiscal.ts"
import { documentEndpoints as x, sessionEndpoints as s } from "./http-endpoints-host.ts"
import { masterDataEndpoints as m } from "./http-endpoints-master-data.ts"

export { CurrentRequest, CurrentSession } from "./api-context.ts"
export type { BrowserPrincipal } from "./api-context.ts"
export { ApiAuthentication, SessionAuthentication } from "./http-api-shared.ts"

export const operationNames = [
  "getIssuer", "configureIssuer", "listDocumentSeries", "addDocumentSeries", "listUnitOfMeasures", "listVatRegimes",
  "listCustomers", "getCustomer", "createCustomer", "updateCustomer", "deleteCustomer",
  "listProductPresets", "createProductPreset", "updateProductPreset", "deleteProductPreset",
  "listDrafts", "getDraft", "createDraft", "updateDraft", "deleteDraft",
  "addDraftLine", "updateDraftLine", "deleteDraftLine", "issueDraftInvoice", "issueInvoice",
  "listPayments", "recordPayment", "reversePayment", "createCorrection", "listCorrections", "getCorrection",
  "listInvoiceRegister", "listIssuedInvoices", "getIssuedInvoice", "renderInvoicePdf", "downloadInvoicePdf",
  "downloadInvoiceEFactura", "downloadCorrectionEFactura",
  "issueDraftProforma", "issueProforma", "listProformas", "getProforma", "issueInvoiceFromProforma", "createDraftInvoiceFromProforma",
  "renderProformaPdf", "downloadProformaPdf", "getSession", "createSession", "deleteSession",
] as const
export type OperationName = typeof operationNames[number]

const invoicing = HttpApiGroup.make("invoicing")
  .add(m.getIssuer).add(m.configureIssuer).add(m.listDocumentSeries).add(m.addDocumentSeries)
  .add(m.listUnitOfMeasures).add(m.listVatRegimes)
  .add(m.listCustomers).add(m.getCustomer).add(m.createCustomer).add(m.updateCustomer).add(m.deleteCustomer)
  .add(m.listProductPresets).add(m.createProductPreset).add(m.updateProductPreset).add(m.deleteProductPreset)
  .add(d.listDrafts).add(d.getDraft).add(d.createDraft).add(d.updateDraft).add(d.deleteDraft)
  .add(d.addDraftLine).add(d.updateDraftLine).add(d.deleteDraftLine).add(d.issueDraftInvoice)
  .add(f.listPayments).add(f.recordPayment).add(f.reversePayment).add(f.createCorrection)
  .add(f.listCorrections).add(f.getCorrection).add(f.downloadCorrectionEFactura)
  .add(f.listInvoiceRegister).add(f.listIssuedInvoices).add(f.issueInvoice).add(f.getIssuedInvoice).add(f.downloadInvoiceEFactura)
  .add(f.issueDraftProforma).add(f.listProformas).add(f.issueProforma).add(f.getProforma)
  .add(f.issueInvoiceFromProforma).add(f.createDraftInvoiceFromProforma)
const documents = HttpApiGroup.make("documents")
  .add(x.renderInvoicePdf).add(x.downloadInvoicePdf).add(x.renderProformaPdf).add(x.downloadProformaPdf)
const sessions = HttpApiGroup.make("sessions").add(s.getSession).add(s.createSession).add(s.deleteSession)

export const applicationHttpApi = HttpApi.make("application")
  .add(invoicing).add(documents).add(sessions).prefix("/api")
  .annotateContext(OpenApi.annotations({
    title: "QWBE Invoicing API",
    description: "Standalone invoice-core, PDF artifact, and browser-session HTTP contract.",
    version: "0.1.0",
  }))
