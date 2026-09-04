import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
  OpenApi,
} from "@effect/platform"
import type { HttpMethod } from "@effect/platform/HttpMethod"
import { Schema } from "effect"

import * as S from "./http-schemas.ts"

export const operationNames = [
  "getIssuer", "configureIssuer", "listDocumentSeries", "addDocumentSeries",
  "listCustomers", "getCustomer", "createCustomer", "updateCustomer", "deleteCustomer",
  "listProductPresets", "createProductPreset", "updateProductPreset", "deleteProductPreset",
  "listDrafts", "getDraft", "createDraft", "updateDraft", "deleteDraft",
  "addDraftLine", "updateDraftLine", "deleteDraftLine", "issueDraftInvoice", "issueInvoice",
  "listPayments", "recordPayment", "createCorrection", "listCorrections", "getCorrection",
  "listIssuedInvoices", "getIssuedInvoice", "renderInvoicePdf", "downloadInvoicePdf",
  "issueDraftProforma", "issueProforma", "listProformas", "getProforma", "issueInvoiceFromProforma", "renderProformaPdf", "downloadProformaPdf",
  "getSession", "createSession", "deleteSession",
] as const
export type OperationName = typeof operationNames[number]

const bearer = HttpApiSecurity.bearer.pipe(
  HttpApiSecurity.annotate(OpenApi.Description, "Authorization: Bearer <standalone API token>"),
)
const sessionCookie = HttpApiSecurity.apiKey({ key: "qwbe_session", in: "cookie" }).pipe(
  HttpApiSecurity.annotate(OpenApi.Description, "Opaque browser session cookie"),
)
class ApiAuthentication extends HttpApiMiddleware.Tag<ApiAuthentication>()("ApiAuthentication", {
  security: { bearerAuth: bearer, sessionCookie },
  failure: S.AuthenticationRequiredError,
}) {}
class SessionAuthentication extends HttpApiMiddleware.Tag<SessionAuthentication>()("SessionAuthentication", {
  security: { sessionCookie },
  failure: S.AuthenticationRequiredError,
}) {}

const id = HttpApiSchema.param("id", Schema.String)
const draftId = HttpApiSchema.param("draftId", Schema.String)
const lineId = HttpApiSchema.param("lineId", Schema.String)
const invoiceId = HttpApiSchema.param("invoiceId", Schema.String)
const proformaId = HttpApiSchema.param("proformaId", Schema.String)
const csrfHeaders = Schema.Struct({
  "x-csrf-token": Schema.optional(Schema.String.annotations({
    description: "Required for unsafe requests authenticated with sessionCookie; ignored for bearerAuth.",
  })),
})
const requiredCsrfHeaders = Schema.Struct({
  "x-csrf-token": Schema.String.annotations({ description: "CSRF token returned by GET or POST /api/session." }),
})

type Endpoint<N extends string, M extends HttpMethod, P, U, B, H, S, E, R, RE> =
  HttpApiEndpoint.HttpApiEndpoint<N, M, P, U, B, H, S, E, R, RE>
const invoicingBase = <N extends string, M extends HttpMethod, P, U, B, H, Success, E, R, RE>(
  endpoint: Endpoint<N, M, P, U, B, H, Success, E, R, RE>,
) => endpoint
  .addError(S.PermissionDeniedError)
  .addError(S.InvoicingInternalError)
  .addError(S.BusinessUnavailableError)
  .middleware(ApiAuthentication)
const documentsBase = <N extends string, M extends HttpMethod, P, U, B, H, Success, E, R, RE>(
  endpoint: Endpoint<N, M, P, U, B, H, Success, E, R, RE>,
) => endpoint
  .addError(S.DocumentsPermissionDeniedError)
  .addError(S.DocumentsInternalError)
  .addError(S.BusinessUnavailableError)
  .middleware(ApiAuthentication)
const body = <N extends string, M extends HttpMethod, P, U, B, H, Success, E, R, RE>(
  endpoint: Endpoint<N, M, P, U, B, H, Success, E, R, RE>,
) => endpoint.setHeaders(csrfHeaders)
  .addError(S.InvalidJsonError)
  .addError(S.PayloadTooLargeError)
  .addError(S.CsrfError)
const validation = <N extends string, M extends HttpMethod, P, U, B, H, Success, E, R, RE>(
  endpoint: Endpoint<N, M, P, U, B, H, Success, E, R, RE>,
) => endpoint.addError(S.ValidationError)
const notFound = <N extends string, M extends HttpMethod, P, U, B, H, Success, E, R, RE>(
  endpoint: Endpoint<N, M, P, U, B, H, Success, E, R, RE>,
) => endpoint.addError(S.ResourceNotFoundError)
const conflict = <N extends string, M extends HttpMethod, P, U, B, H, Success, E, R, RE>(
  endpoint: Endpoint<N, M, P, U, B, H, Success, E, R, RE>,
) => endpoint.addError(S.DomainConflictError)

const invoicing = HttpApiGroup.make("invoicing")
  .add(invoicingBase(notFound(HttpApiEndpoint.get("getIssuer", "/issuer").addSuccess(S.Issuer))))
  .add(invoicingBase(validation(body(HttpApiEndpoint.put("configureIssuer", "/issuer").setPayload(S.IssuerInput).addSuccess(S.Issuer)))))
  .add(invoicingBase(HttpApiEndpoint.get("listDocumentSeries", "/document-series").addSuccess(Schema.Array(S.DocumentSeries))))
  .add(invoicingBase(conflict(validation(body(HttpApiEndpoint.post("addDocumentSeries", "/document-series").setPayload(S.DocumentSeriesInput).addSuccess(S.DocumentSeries))))))
  .add(invoicingBase(HttpApiEndpoint.get("listCustomers", "/customers").addSuccess(Schema.Array(S.Customer))))
  .add(invoicingBase(notFound(HttpApiEndpoint.get("getCustomer")`/customers/${id}`.addSuccess(S.Customer))))
  .add(invoicingBase(validation(body(HttpApiEndpoint.post("createCustomer", "/customers").setPayload(S.CustomerInput).addSuccess(S.Customer)))))
  .add(invoicingBase(notFound(validation(body(HttpApiEndpoint.put("updateCustomer")`/customers/${id}`.setPayload(S.CustomerInput).addSuccess(S.Customer))))))
  .add(invoicingBase(conflict(notFound(body(HttpApiEndpoint.del("deleteCustomer")`/customers/${id}`.addSuccess(S.Deleted))))))
  .add(invoicingBase(HttpApiEndpoint.get("listProductPresets", "/product-presets").addSuccess(Schema.Array(S.ProductPreset))))
  .add(invoicingBase(validation(body(HttpApiEndpoint.post("createProductPreset", "/product-presets").setPayload(S.ProductPresetInput).addSuccess(S.ProductPreset)))))
  .add(invoicingBase(notFound(validation(body(HttpApiEndpoint.put("updateProductPreset")`/product-presets/${id}`
    .setPayload(S.ProductPresetInput).addSuccess(S.ProductPreset))))))
  .add(invoicingBase(notFound(body(HttpApiEndpoint.del("deleteProductPreset")`/product-presets/${id}`.addSuccess(S.Deleted)))))
  .add(invoicingBase(HttpApiEndpoint.get("listDrafts", "/drafts").addSuccess(Schema.Array(S.DraftInvoice))))
  .add(invoicingBase(notFound(HttpApiEndpoint.get("getDraft")`/drafts/${id}`.addSuccess(S.DraftInvoice))))
  .add(invoicingBase(notFound(validation(body(HttpApiEndpoint.post("createDraft", "/drafts").setPayload(S.DraftInput).addSuccess(S.DraftInvoice))))))
  .add(invoicingBase(conflict(notFound(validation(body(HttpApiEndpoint.put("updateDraft")`/drafts/${id}`.setPayload(S.UpdateDraftInput).addSuccess(S.DraftInvoice)))))))
  .add(invoicingBase(conflict(notFound(body(HttpApiEndpoint.del("deleteDraft")`/drafts/${id}`.addSuccess(S.Deleted))))))
  .add(invoicingBase(conflict(notFound(validation(body(HttpApiEndpoint.post("addDraftLine")`/drafts/${draftId}/lines`.setPayload(S.DraftLineInput).addSuccess(S.DraftInvoice)))))))
  .add(invoicingBase(conflict(notFound(validation(body(HttpApiEndpoint.put("updateDraftLine")`/drafts/${draftId}/lines/${lineId}`.setPayload(S.DraftLineInput).addSuccess(S.DraftInvoice)))))))
  .add(invoicingBase(conflict(notFound(body(HttpApiEndpoint.del("deleteDraftLine")`/drafts/${draftId}/lines/${lineId}`.addSuccess(S.DraftInvoice))))))
  .add(invoicingBase(conflict(notFound(validation(body(HttpApiEndpoint.post("issueDraftInvoice")`/drafts/${draftId}/issue`.addSuccess(S.IssuedInvoice)))))))
  .add(invoicingBase(notFound(HttpApiEndpoint.get("listPayments")`/invoices/${invoiceId}/payments`.addSuccess(S.PaymentSummary))))
  .add(invoicingBase(notFound(validation(body(HttpApiEndpoint.post("recordPayment")`/invoices/${invoiceId}/payments`.setPayload(S.PaymentInput).addSuccess(S.RecordPaymentResult))))))
  .add(invoicingBase(conflict(notFound(validation(body(HttpApiEndpoint.post("createCorrection")`/invoices/${invoiceId}/corrections`.setPayload(S.CorrectionInput).addSuccess(S.Correction)))))))
  .add(invoicingBase(HttpApiEndpoint.get("listCorrections")`/invoices/${invoiceId}/corrections`.addSuccess(Schema.Array(S.Correction))))
  .add(invoicingBase(notFound(HttpApiEndpoint.get("getCorrection")`/corrections/${id}`.addSuccess(S.Correction))))
  .add(invoicingBase(HttpApiEndpoint.get("listIssuedInvoices", "/invoices").addSuccess(Schema.Array(S.IssuedInvoice))))
  .add(invoicingBase(conflict(notFound(validation(body(HttpApiEndpoint.post("issueInvoice", "/invoices").setPayload(S.AuthoringDocumentInput).addSuccess(S.IssuedInvoice)))))))
  .add(invoicingBase(notFound(HttpApiEndpoint.get("getIssuedInvoice")`/invoices/${id}`.addSuccess(S.IssuedInvoice))))
  .add(invoicingBase(conflict(notFound(validation(body(HttpApiEndpoint.post("issueDraftProforma")`/drafts/${draftId}/proformas`
    .setPayload(S.IssueProformaInput).addSuccess(S.Proforma)))))))
  .add(invoicingBase(HttpApiEndpoint.get("listProformas", "/proformas").addSuccess(Schema.Array(S.Proforma))))
  .add(invoicingBase(conflict(notFound(validation(body(HttpApiEndpoint.post("issueProforma", "/proformas")
    .setPayload(S.AuthoringProformaInput).addSuccess(S.Proforma)))))))
  .add(invoicingBase(notFound(HttpApiEndpoint.get("getProforma")`/proformas/${id}`.addSuccess(S.Proforma))))
  .add(invoicingBase(conflict(notFound(body(HttpApiEndpoint.post("issueInvoiceFromProforma")`/proformas/${id}/invoice`
    .setPayload(S.EmptyInput).addSuccess(S.IssuedInvoice))))))

const documents = HttpApiGroup.make("documents")
  .add(documentsBase(body(HttpApiEndpoint.post("renderInvoicePdf")`/invoices/${invoiceId}/pdf`.addSuccess(S.Artifact)
    .addError(S.DocumentNotFoundError).addError(S.ArtifactConflictError))))
  .add(documentsBase(HttpApiEndpoint.get("downloadInvoicePdf")`/invoices/${invoiceId}/pdf`.addSuccess(S.Pdf)
    .addError(S.DocumentNotFoundError)))
  .add(documentsBase(body(HttpApiEndpoint.post("renderProformaPdf")`/proformas/${proformaId}/pdf`.setPayload(S.EmptyInput)
    .addSuccess(S.ProformaArtifact).addError(S.DocumentNotFoundError).addError(S.ArtifactConflictError))))
  .add(documentsBase(HttpApiEndpoint.get("downloadProformaPdf")`/proformas/${proformaId}/pdf`.addSuccess(S.Pdf)
    .addError(S.DocumentNotFoundError)))

const sessions = HttpApiGroup.make("sessions")
  .add(HttpApiEndpoint.get("getSession", "/session").addSuccess(S.AuthenticatedSession)
    .addError(S.SessionInternalError).addError(S.ReadinessError)
    .middleware(SessionAuthentication))
  .add(HttpApiEndpoint.post("createSession", "/session").setPayload(S.LoginInput).addSuccess(S.AuthenticatedSession)
    .addError(S.InvalidJsonError).addError(S.InvalidCredentialsRequestError).addError(S.InvalidCredentialsError)
    .addError(S.OriginForbiddenError)
    .addError(S.PayloadTooLargeError)
    .addError(S.SessionInternalError).addError(S.ReadinessError))
  .add(HttpApiEndpoint.del("deleteSession", "/session").setHeaders(requiredCsrfHeaders).addSuccess(S.LoggedOutSession)
    .addError(S.CsrfError).addError(S.SessionInternalError).addError(S.ReadinessError)
    .middleware(SessionAuthentication))

export const applicationHttpApi = HttpApi.make("application")
  .add(invoicing)
  .add(documents)
  .add(sessions)
  .prefix("/api")
  .annotateContext(OpenApi.annotations({
    title: "QWBE Invoicing API",
    description: "Standalone invoice-core, PDF artifact, and browser-session HTTP contract.",
    version: "0.1.0",
  }))
