import { HttpApiEndpoint, OpenApi } from "@effect/platform"

import {
  addRetryAfterHeader, body, documentsBase, invoiceId, proformaId, requiredCsrfHeaders, SessionAuthentication,
} from "./http-api-shared.ts"
import * as D from "./schema-documents.ts"
import * as E from "./schema-errors-session.ts"

export const documentEndpoints = {
  renderInvoicePdf: documentsBase(body(HttpApiEndpoint.post("renderInvoicePdf")`/invoices/${invoiceId}/pdf`.addSuccess(D.Artifact)
    .addError(E.DocumentNotFoundError).addError(E.ArtifactConflictError))),
  downloadInvoicePdf: documentsBase(HttpApiEndpoint.get("downloadInvoicePdf")`/invoices/${invoiceId}/pdf`.addSuccess(D.Pdf)
    .addError(E.DocumentNotFoundError)),
  renderProformaPdf: documentsBase(body(HttpApiEndpoint.post("renderProformaPdf")`/proformas/${proformaId}/pdf`.setPayload(D.EmptyInput)
    .addSuccess(D.ProformaArtifact).addError(E.DocumentNotFoundError).addError(E.ArtifactConflictError))),
  downloadProformaPdf: documentsBase(HttpApiEndpoint.get("downloadProformaPdf")`/proformas/${proformaId}/pdf`.addSuccess(D.Pdf)
    .addError(E.DocumentNotFoundError)),
} as const

export const sessionEndpoints = {
  getSession: HttpApiEndpoint.get("getSession", "/session").addSuccess(E.AuthenticatedSession)
    .addError(E.SessionInternalError).addError(E.ReadinessError).middleware(SessionAuthentication),
  createSession: HttpApiEndpoint.post("createSession", "/session").setPayload(E.LoginInput).addSuccess(E.AuthenticatedSession)
    .addError(E.InvalidJsonError).addError(E.InvalidCredentialsRequestError).addError(E.InvalidCredentialsError)
    .addError(E.TooManyAttemptsError).addError(E.OriginForbiddenError).addError(E.PayloadTooLargeError)
    .addError(E.SessionInternalError).addError(E.ReadinessError).annotate(OpenApi.Transform, addRetryAfterHeader),
  deleteSession: HttpApiEndpoint.del("deleteSession", "/session").setHeaders(requiredCsrfHeaders).addSuccess(E.LoggedOutSession)
    .addError(E.CsrfError).addError(E.SessionInternalError).addError(E.ReadinessError).middleware(SessionAuthentication),
} as const
