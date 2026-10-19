import { HttpApi, type HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform"

import { draftEndpoints as d } from "./http-endpoints-drafts.ts"
import { fiscalEndpoints as f } from "./http-endpoints-fiscal.ts"
import { documentEndpoints as x, sessionEndpoints as s } from "./http-endpoints-host.ts"
import { masterDataEndpoints as m } from "./http-endpoints-master-data.ts"
import type { PluginSelection } from "../plugins.ts"

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
  "listInvoiceRegister", "getRevenueReport", "getCollectionsReport", "listIssuedInvoices", "getIssuedInvoice", "renderInvoicePdf", "downloadInvoicePdf",
  "downloadInvoiceEFactura", "downloadCorrectionEFactura",
  "issueDraftProforma", "issueProforma", "listProformas", "getProforma", "issueInvoiceFromProforma", "createDraftInvoiceFromProforma",
  "renderProformaPdf", "downloadProformaPdf", "downloadCorrectionPdf", "getSession", "createSession", "deleteSession",
] as const
export type OperationName = typeof operationNames[number]

const invoicing = HttpApiGroup.make("invoicing")
  .add(m.getIssuer).add(m.configureIssuer).add(m.listDocumentSeries).add(m.addDocumentSeries)
  .add(m.listUnitOfMeasures).add(m.listVatRegimes)
  .add(m.listCustomers).add(m.getCustomer).add(m.createCustomer).add(m.updateCustomer).add(m.deleteCustomer)
  .add(m.listProductPresets).add(m.createProductPreset).add(m.updateProductPreset).add(m.deleteProductPreset)
  .add(d.listDrafts).add(d.getDraft).add(d.createDraft).add(d.updateDraft).add(d.deleteDraft)
  .add(d.addDraftLine).add(d.updateDraftLine).add(d.deleteDraftLine).add(d.issueDraftInvoice)
  .add(f.createCorrection).add(f.listCorrections).add(f.getCorrection)
  .add(f.listInvoiceRegister).add(f.getRevenueReport).add(f.listIssuedInvoices).add(f.issueInvoice).add(f.getIssuedInvoice)
  .add(f.issueDraftProforma).add(f.listProformas).add(f.issueProforma).add(f.getProforma)
  .add(f.issueInvoiceFromProforma).add(f.createDraftInvoiceFromProforma)
// The plugins' endpoints stay in the `invoicing` group, so their operation ids
// and their OpenAPI tag are the ones they had before they could be switched off.
type InvoicingGroup<E extends HttpApiEndpoint.HttpApiEndpoint.Any, R> = HttpApiGroup.HttpApiGroup<"invoicing", E, never, R, boolean>
const withPayments = <E extends HttpApiEndpoint.HttpApiEndpoint.Any, R>(group: InvoicingGroup<E, R>) =>
  group.add(f.listPayments).add(f.recordPayment).add(f.reversePayment).add(f.getCollectionsReport)
const withEFactura = <E extends HttpApiEndpoint.HttpApiEndpoint.Any, R>(group: InvoicingGroup<E, R>) =>
  group.add(f.downloadInvoiceEFactura).add(f.downloadCorrectionEFactura)
const documents = HttpApiGroup.make("documents")
  .add(x.renderInvoicePdf).add(x.downloadInvoicePdf).add(x.renderProformaPdf).add(x.downloadProformaPdf)
  .add(x.downloadCorrectionPdf)
const sessions = HttpApiGroup.make("sessions").add(s.getSession).add(s.createSession).add(s.deleteSession)
const application = <E extends HttpApiEndpoint.HttpApiEndpoint.Any, R>(group: InvoicingGroup<E, R>) =>
  HttpApi.make("application").add(group).add(documents).add(sessions).prefix("/api")

/**
 * The routes every installation serves. Each plugin is its own API value, so
 * `createApiHandler` mounts its routes only when the plugin is on and a route
 * that is off is a 404 from the router, not a handler answering something else.
 * Plugin errors are the core's own error schemas, so the core API encodes them.
 */
export const applicationHttpApi = application(invoicing)
export const paymentsHttpApi = HttpApi.make("application").add(withPayments(HttpApiGroup.make("invoicing"))).prefix("/api")
export const efacturaHttpApi = HttpApi.make("application").add(withEFactura(HttpApiGroup.make("invoicing"))).prefix("/api")

/** The contract this installation serves, for OpenAPI: the core plus the active plugins, in one invoicing group. */
export const activeHttpApi = (plugins: PluginSelection) => {
  const paid = plugins.payments ? withPayments(invoicing) : invoicing
  return application(plugins.efactura ? withEFactura(paid) : paid).annotateContext(OpenApi.annotations({
    title: "QWBE Invoicing API",
    description: "Kernel invoice-core, PDF artifact, and browser-session HTTP contract.",
    version: "0.1.0",
  }))
}
