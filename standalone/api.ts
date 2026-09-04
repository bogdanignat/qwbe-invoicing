import { randomUUID } from "node:crypto"

import { Effect, Either } from "effect"

import {
  AuthenticationRequired,
  DomainConflict,
  OrganizationContextMissing,
  PermissionDenied,
  PersistenceFailure,
  ResourceNotFound,
  ValidationFailure,
  createInvoicingService,
  type InvoicingFailure,
} from "../cube/invoicing/index.ts"
import {
  AuthenticationRequired as PaymentsAuthenticationRequired,
  DomainConflict as PaymentsDomainConflict,
  OrganizationContextMissing as PaymentsOrganizationContextMissing,
  PermissionDenied as PaymentsPermissionDenied,
  PersistenceFailure as PaymentsPersistenceFailure,
  ResourceNotFound as PaymentsResourceNotFound,
  ValidationFailure as PaymentsValidationFailure,
  createPaymentsService,
  type PaymentsFailure,
} from "../cube/payments/index.ts"
import {
  ArtifactConflict,
  DocumentNotFound,
  DocumentPersistenceFailure,
  DocumentRenderingFailure,
  DocumentsPermissionDenied,
  type DocumentsFailure,
} from "../cube/invoicing/documents/index.ts"
import { createStandaloneArtifactService } from "./artifact-runtime.ts"
import { authoringInvoiceInput, authoringProformaInput, correctionInput, customerInput, documentSeriesInput, draftInput, emptyInput, issuerInput, issueProformaInput, lineInput, paymentInput, productPresetInput, updateDraftInput, updateLineInput } from "./api-inputs.ts"
import { matchApplicationRoute } from "./api-route-adapter.ts"
import type { RequestAuthenticator } from "./auth.ts"
import { createSqlitePaymentsStore, createSqliteStore } from "./sqlite-store.ts"

export interface ApiRequest {
  readonly method: string
  readonly url: string
  readonly authorization: string | undefined
  readonly body: unknown
}

export interface ApiResponse {
  readonly status: number
  readonly body: unknown
  readonly headers?: Readonly<Record<string, string>>
}

export interface ApiRuntime {
  readonly authenticate: RequestAuthenticator
  readonly dataDirectory: string
}

type ApiFailure = InvoicingFailure | PaymentsFailure | DocumentsFailure

const failureResponse = (failure: ApiFailure): ApiResponse => {
  if (failure instanceof AuthenticationRequired) return { status: 401, body: { error: failure._tag } }
  if (failure instanceof OrganizationContextMissing) return { status: 503, body: { error: failure._tag } }
  if (failure instanceof PermissionDenied) return { status: 403, body: { error: failure._tag } }
  if (failure instanceof ValidationFailure) return { status: 400, body: { error: failure._tag, issues: failure.issues } }
  if (failure instanceof ResourceNotFound) return { status: 404, body: { error: failure._tag } }
  if (failure instanceof DomainConflict) return { status: 409, body: { error: failure._tag, code: failure.code } }
  if (failure instanceof PersistenceFailure) return { status: 500, body: { error: failure._tag } }
  if (failure instanceof PaymentsAuthenticationRequired) return { status: 401, body: { error: failure._tag } }
  if (failure instanceof PaymentsOrganizationContextMissing) return { status: 503, body: { error: failure._tag } }
  if (failure instanceof PaymentsPermissionDenied) return { status: 403, body: { error: failure._tag } }
  if (failure instanceof PaymentsValidationFailure) return { status: 400, body: { error: failure._tag, issues: failure.issues } }
  if (failure instanceof PaymentsResourceNotFound) return { status: 404, body: { error: failure._tag } }
  if (failure instanceof PaymentsDomainConflict) return { status: 409, body: { error: failure._tag, code: failure.code } }
  if (failure instanceof PaymentsPersistenceFailure) return { status: 500, body: { error: failure._tag } }
  if (failure instanceof DocumentsPermissionDenied) return { status: 403, body: { error: failure._tag } }
  if (failure instanceof DocumentNotFound) return { status: 404, body: { error: failure._tag } }
  if (failure instanceof ArtifactConflict) return { status: 409, body: { error: failure._tag } }
  if (failure instanceof DocumentPersistenceFailure || failure instanceof DocumentRenderingFailure) {
    return { status: 500, body: { error: failure._tag } }
  }
  return { status: 500, body: { error: "internal_failure" } }
}

export const handleApiRequest = async (request: ApiRequest, runtime: ApiRuntime): Promise<ApiResponse> => {
  const authenticated = await Effect.runPromise(Effect.either(runtime.authenticate(request.authorization).current))
  if (Either.isLeft(authenticated)) return failureResponse(authenticated.left)
  const authenticatedContext = authenticated.right
  const store = createSqliteStore(runtime.dataDirectory)
  const paymentsStore = createSqlitePaymentsStore(runtime.dataDirectory)
  const service = createInvoicingService({
    context: { current: Effect.succeed(authenticatedContext) },
    clock: { now: Effect.sync(() => new Date()) },
    ids: { next: Effect.sync(randomUUID) },
    store,
    cubeIdentity: "invoicing",
  })
  const payments = createPaymentsService({
    context: { current: Effect.succeed(authenticatedContext) },
    clock: { now: Effect.sync(() => new Date()) },
    ids: { next: Effect.sync(randomUUID) },
    store: paymentsStore,
    cubeIdentity: "payments",
  })
  const documents = createStandaloneArtifactService(runtime.dataDirectory, Effect.succeed({
    identity: {
      id: authenticatedContext.identity.id,
      permissions: authenticatedContext.identity.permissions,
    },
    organization: authenticatedContext.organization,
  }))
  try {
    const route = matchApplicationRoute(request.method, request.url)
    if (route.kind === "method_not_allowed") return { status: 405, body: { error: "method_not_allowed" } }
    if (route.kind === "not_found") return { status: 404, body: { error: "not_found" } }

    const pathParam = (name: string): string => {
      const value = route.pathParams[name]
      if (value === undefined) throw new Error(`missing reflected path parameter: ${name}`)
      return value
    }
    let operation: Effect.Effect<unknown, ApiFailure>
    switch (route.operationId) {
      case "getIssuer": operation = service.getIssuer(); break
      case "configureIssuer": operation = service.configureIssuer(issuerInput(request.body)); break
      case "listDocumentSeries": operation = service.listDocumentSeries(); break
      case "addDocumentSeries": operation = service.addDocumentSeries(documentSeriesInput(request.body)); break
      case "listCustomers": operation = service.listCustomers(); break
      case "getCustomer": operation = service.getCustomer(pathParam("id")); break
      case "createCustomer": operation = service.createCustomer(customerInput(request.body)); break
      case "updateCustomer": operation = service.updateCustomer({ id: pathParam("id"), ...customerInput(request.body) }); break
      case "deleteCustomer": operation = Effect.map(service.deleteCustomer(pathParam("id")), () => ({ deleted: true } as const)); break
      case "listProductPresets": operation = service.listProductPresets(); break
      case "createProductPreset": operation = service.createProductPreset(productPresetInput(request.body)); break
      case "updateProductPreset": operation = service.updateProductPreset({ id: pathParam("id"), ...productPresetInput(request.body) }); break
      case "deleteProductPreset": operation = Effect.map(service.deleteProductPreset(pathParam("id")), () => ({ deleted: true } as const)); break
      case "listDrafts": operation = service.listDrafts(); break
      case "getDraft": operation = service.getDraft(pathParam("id")); break
      case "createDraft": operation = service.createDraft(draftInput(request.body)); break
      case "updateDraft": operation = service.updateDraft(updateDraftInput(pathParam("id"), request.body)); break
      case "deleteDraft": operation = Effect.map(service.deleteDraft(pathParam("id")), () => ({ deleted: true } as const)); break
      case "addDraftLine": operation = service.addDraftLine(lineInput(pathParam("draftId"), request.body)); break
      case "updateDraftLine": operation = service.updateDraftLine(updateLineInput(pathParam("draftId"), pathParam("lineId"), request.body)); break
      case "deleteDraftLine": operation = service.deleteDraftLine(pathParam("draftId"), pathParam("lineId")); break
      case "issueDraftInvoice": operation = service.issueInvoice({ draftId: pathParam("draftId") }); break
      case "issueInvoice": operation = service.issueInvoice(authoringInvoiceInput(request.body)); break
      case "listPayments": operation = payments.listPayments(pathParam("invoiceId")); break
      case "recordPayment": operation = payments.recordPayment(paymentInput(pathParam("invoiceId"), request.body)); break
      case "createCorrection": operation = service.createCorrection(correctionInput(pathParam("invoiceId"), request.body)); break
      case "listCorrections": operation = service.listCorrections(pathParam("invoiceId")); break
      case "getCorrection": operation = service.getCorrection(pathParam("id")); break
      case "listIssuedInvoices": operation = service.listIssuedInvoices(); break
      case "getIssuedInvoice": operation = service.getIssuedInvoice(pathParam("id")); break
      case "issueDraftProforma": operation = service.issueProforma(issueProformaInput(pathParam("draftId"), request.body)); break
      case "issueProforma": operation = service.issueProforma(authoringProformaInput(request.body)); break
      case "listProformas": operation = service.listProformas(); break
      case "getProforma": operation = service.getProforma(pathParam("id")); break
      case "issueInvoiceFromProforma": emptyInput(request.body); operation = service.issueInvoiceFromProforma({ proformaId: pathParam("id") }); break
      case "renderInvoicePdf": operation = documents.renderInvoice(pathParam("invoiceId")); break
      case "downloadInvoicePdf": {
        const invoiceId = pathParam("invoiceId")
        const result = await Effect.runPromise(Effect.either(documents.downloadInvoice(invoiceId)))
        if (Either.isLeft(result)) return failureResponse(result.left)
        const filenameId = invoiceId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || "invoice"
        return {
          status: 200,
          body: result.right.bytes,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="invoice-${filenameId}.pdf"`,
            "content-length": String(result.right.bytes.length),
            "x-content-type-options": "nosniff",
            etag: `"sha256-${result.right.artifact.sha256}"`,
          },
        }
      }
      case "renderProformaPdf": emptyInput(request.body); operation = documents.renderProforma(pathParam("proformaId")); break
      case "downloadProformaPdf": {
        const proformaId = pathParam("proformaId")
        const result = await Effect.runPromise(Effect.either(documents.downloadProforma(proformaId)))
        if (Either.isLeft(result)) return failureResponse(result.left)
        const filenameId = proformaId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || "proforma"
        return {
          status: 200,
          body: result.right.bytes,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="proforma-${filenameId}.pdf"`,
            "content-length": String(result.right.bytes.length),
            "x-content-type-options": "nosniff",
            etag: `"sha256-${result.right.artifact.sha256}"`,
          },
        }
      }
      case "getSession":
      case "createSession":
      case "deleteSession":
        return { status: 404, body: { error: "not_found" } }
    }
    const result = await Effect.runPromise(Effect.either(operation))
    return Either.isLeft(result) ? failureResponse(result.left) : { status: 200, body: result.right }
  } catch (error) {
    return error instanceof ValidationFailure
      ? failureResponse(error)
      : { status: 500, body: { error: "internal_failure" } }
  }
}
