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
  type AddDraftLineInput,
  type ConfigureIssuerInput,
  type CreateCustomerInput,
  type CreateDraftInput,
  type InvoicingFailure,
} from "../cube/invoicing/index.ts"
import {
  ArtifactConflict,
  DocumentNotFound,
  DocumentPersistenceFailure,
  DocumentRenderingFailure,
  DocumentsPermissionDenied,
  type DocumentsFailure,
} from "../cube/invoicing/documents/index.ts"
import { createStandaloneArtifactService } from "./artifact-runtime.ts"
import type { RequestAuthenticator } from "./auth.ts"
import { createSqliteStore } from "./sqlite-store.ts"

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

type JsonObject = Readonly<Record<string, unknown>>

const object = (value: unknown): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationFailure({ issues: ["request body must be a JSON object"] })
  }
  return value as JsonObject
}

const text = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new ValidationFailure({ issues: [`${field} must be a string`] })
  return value
}

const optionalText = (value: unknown, field: string): string | undefined =>
  value === undefined ? undefined : text(value, field)

const integer = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ValidationFailure({ issues: [`${field} must be an integer`] })
  }
  return value
}

const address = (value: unknown) => {
  const input = object(value)
  const result = {
    countryCode: text(input.countryCode, "address.countryCode"),
    city: text(input.city, "address.city"),
    street: text(input.street, "address.street"),
    county: optionalText(input.county, "address.county"),
    postalCode: optionalText(input.postalCode, "address.postalCode"),
  }
  return {
    countryCode: result.countryCode,
    city: result.city,
    street: result.street,
    ...(result.county === undefined ? {} : { county: result.county }),
    ...(result.postalCode === undefined ? {} : { postalCode: result.postalCode }),
  }
}

const taxConfigurations = (value: unknown): ConfigureIssuerInput["taxConfigurations"] => {
  if (!Array.isArray(value)) throw new ValidationFailure({ issues: ["taxConfigurations must be an array"] })
  return value.map((item) => {
    const input = object(item)
    const effectiveTo = optionalText(input.effectiveTo, "taxConfigurations.effectiveTo")
    return {
      code: text(input.code, "taxConfigurations.code"),
      category: "standard" as const,
      rate: text(input.rate, "taxConfigurations.rate"),
      effectiveFrom: text(input.effectiveFrom, "taxConfigurations.effectiveFrom"),
      ...(effectiveTo === undefined ? {} : { effectiveTo }),
    }
  })
}

const issuerInput = (value: unknown): ConfigureIssuerInput => {
  const input = object(value)
  return {
    legalName: text(input.legalName, "legalName"),
    taxIdentifier: text(input.taxIdentifier, "taxIdentifier"),
    address: address(input.address),
    defaultCurrency: text(input.defaultCurrency, "defaultCurrency"),
    defaultPaymentTermDays: integer(input.defaultPaymentTermDays, "defaultPaymentTermDays"),
    defaultSeries: text(input.defaultSeries, "defaultSeries"),
    taxConfigurations: taxConfigurations(input.taxConfigurations),
  }
}

const customerInput = (value: unknown): CreateCustomerInput => {
  const input = object(value)
  return {
    legalName: text(input.legalName, "legalName"),
    taxIdentifier: text(input.taxIdentifier, "taxIdentifier"),
    address: address(input.address),
  }
}

const draftInput = (value: unknown): CreateDraftInput => {
  const input = object(value)
  const currency = optionalText(input.currency, "currency")
  const dueDate = optionalText(input.dueDate, "dueDate")
  return {
    customerId: text(input.customerId, "customerId"),
    issueDate: text(input.issueDate, "issueDate"),
    ...(currency === undefined ? {} : { currency }),
    ...(dueDate === undefined ? {} : { dueDate }),
  }
}

const lineInput = (draftId: string, value: unknown): AddDraftLineInput => {
  const input = object(value)
  return {
    draftId,
    description: text(input.description, "description"),
    quantity: text(input.quantity, "quantity"),
    unitPrice: text(input.unitPrice, "unitPrice"),
    taxCode: text(input.taxCode, "taxCode"),
  }
}

const paymentInput = (invoiceId: string, value: unknown) => {
  const input = object(value)
  const externalReference = optionalText(input.externalReference, "externalReference")
  const note = optionalText(input.note, "note")
  return {
    invoiceId,
    amount: text(input.amount, "amount"),
    currency: text(input.currency, "currency"),
    paymentDate: text(input.paymentDate, "paymentDate"),
    method: text(input.method, "method"),
    ...(externalReference === undefined ? {} : { externalReference }),
    ...(note === undefined ? {} : { note }),
  }
}

type ApiFailure = InvoicingFailure | DocumentsFailure

const failureResponse = (failure: ApiFailure): ApiResponse => {
  if (failure instanceof AuthenticationRequired) return { status: 401, body: { error: failure._tag } }
  if (failure instanceof OrganizationContextMissing) return { status: 503, body: { error: failure._tag } }
  if (failure instanceof PermissionDenied) return { status: 403, body: { error: failure._tag } }
  if (failure instanceof ValidationFailure) return { status: 400, body: { error: failure._tag, issues: failure.issues } }
  if (failure instanceof ResourceNotFound) return { status: 404, body: { error: failure._tag } }
  if (failure instanceof DomainConflict) return { status: 409, body: { error: failure._tag, code: failure.code } }
  if (failure instanceof PersistenceFailure) return { status: 500, body: { error: failure._tag } }
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
  const service = createInvoicingService({
    context: { current: Effect.succeed(authenticatedContext) },
    clock: { now: Effect.sync(() => new Date()) },
    ids: { next: Effect.sync(randomUUID) },
    store: createSqliteStore(runtime.dataDirectory),
    cubeIdentity: "invoicing",
  })
  const documents = createStandaloneArtifactService(runtime.dataDirectory, Effect.succeed({
    identity: {
      id: authenticatedContext.identity.id,
      permissions: authenticatedContext.identity.permissions,
    },
    organization: authenticatedContext.organization,
  }))
  try {
    let operation: Effect.Effect<unknown, ApiFailure>
    const customerGet = /^\/api\/customers\/([^/]+)$/.exec(request.url)
    const draftGet = /^\/api\/drafts\/([^/]+)$/.exec(request.url)
    const line = /^\/api\/drafts\/([^/]+)\/lines$/.exec(request.url)
    const issue = /^\/api\/drafts\/([^/]+)\/issue$/.exec(request.url)
    const invoice = /^\/api\/invoices\/([^/]+)$/.exec(request.url)
    const pdf = /^\/api\/invoices\/([^/]+)\/pdf$/.exec(request.url)
    const payments = /^\/api\/invoices\/([^/]+)\/payments$/.exec(request.url)
    if (request.method === "GET" && request.url === "/api/issuer") operation = service.getIssuer()
    else if (request.method === "PUT" && request.url === "/api/issuer") operation = service.configureIssuer(issuerInput(request.body))
    else if (request.method === "GET" && customerGet?.[1] !== undefined) operation = service.getCustomer(customerGet[1])
    else if (request.method === "POST" && request.url === "/api/customers") operation = service.createCustomer(customerInput(request.body))
    else if (request.method === "GET" && draftGet?.[1] !== undefined) operation = service.getDraft(draftGet[1])
    else if (request.method === "POST" && request.url === "/api/drafts") operation = service.createDraft(draftInput(request.body))
    else if (request.method === "POST" && line?.[1] !== undefined) operation = service.addDraftLine(lineInput(line[1], request.body))
      else if (request.method === "POST" && issue?.[1] !== undefined) operation = service.issueInvoice({ draftId: issue[1] })
      else if (request.method === "GET" && payments?.[1] !== undefined) operation = service.listPayments(payments[1])
      else if (request.method === "POST" && payments?.[1] !== undefined) operation = service.recordPayment(paymentInput(payments[1], request.body))
      else if (request.method === "GET" && invoice?.[1] !== undefined) operation = service.getIssuedInvoice(invoice[1])
      else if (request.method === "POST" && pdf?.[1] !== undefined) operation = documents.renderInvoice(pdf[1])
      else if (request.method === "GET" && pdf?.[1] !== undefined) {
        const result = await Effect.runPromise(Effect.either(documents.downloadInvoice(pdf[1])))
        if (Either.isLeft(result)) return failureResponse(result.left)
        const filenameId = pdf[1].replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || "invoice"
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
      else {
        const knownRoute = request.url === "/api/issuer"
          || request.url === "/api/customers"
          || request.url === "/api/drafts"
          || customerGet !== null
          || draftGet !== null
          || line !== null
          || issue !== null
          || invoice !== null
          || pdf !== null
          || payments !== null
        return knownRoute
          ? { status: 405, body: { error: "method_not_allowed" } }
          : { status: 404, body: { error: "not_found" } }
      }
    const result = await Effect.runPromise(Effect.either(operation))
    return Either.isLeft(result) ? failureResponse(result.left) : { status: 200, body: result.right }
  } catch (error) {
    return error instanceof ValidationFailure
      ? failureResponse(error)
      : { status: 500, body: { error: "internal_failure" } }
  }
}
