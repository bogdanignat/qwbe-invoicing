import { HttpApiEndpoint, HttpApiMiddleware, HttpApiSchema, HttpApiSecurity, OpenApi } from "@effect/platform"
import type { HttpMethod } from "@effect/platform/HttpMethod"
import { Schema } from "effect"

import { CurrentRequest, CurrentSession } from "./api-context.ts"
import * as E from "./schema-errors-session.ts"

const bearer = HttpApiSecurity.bearer.pipe(
  HttpApiSecurity.annotate(OpenApi.Description, "Authorization: Bearer <standalone API token>"),
)
const sessionCookie = HttpApiSecurity.apiKey({ key: "qwbe_session", in: "cookie" }).pipe(
  HttpApiSecurity.annotate(OpenApi.Description, "Opaque browser session cookie"),
)
export class ApiAuthentication extends HttpApiMiddleware.Tag<ApiAuthentication>()("ApiAuthentication", {
  security: { bearerAuth: bearer, sessionCookie },
  failure: Schema.Union(E.AuthenticationRequiredError, E.CsrfError, E.BusinessUnavailableError),
  provides: CurrentRequest,
}) {}
export class SessionAuthentication extends HttpApiMiddleware.Tag<SessionAuthentication>()("SessionAuthentication", {
  security: { sessionCookie }, failure: E.AuthenticationRequiredError, provides: CurrentSession,
}) {}

export const id = HttpApiSchema.param("id", Schema.String)
export const draftId = HttpApiSchema.param("draftId", Schema.String)
export const lineId = HttpApiSchema.param("lineId", Schema.String)
export const invoiceId = HttpApiSchema.param("invoiceId", Schema.String)
export const proformaId = HttpApiSchema.param("proformaId", Schema.String)
export const paymentId = HttpApiSchema.param("paymentId", Schema.String)
export const csrfHeaders = Schema.Struct({
  "x-csrf-token": Schema.optional(Schema.String.annotations({
    description: "Required for unsafe requests authenticated with sessionCookie; ignored for bearerAuth.",
  })),
})
export const requiredCsrfHeaders = Schema.Struct({
  "x-csrf-token": Schema.String.annotations({ description: "CSRF token returned by GET or POST /api/session." }),
})
export const idempotentHeaders = Schema.Struct({
  "x-csrf-token": Schema.optional(Schema.String.annotations({
    description: "Required for unsafe requests authenticated with sessionCookie; ignored for bearerAuth.",
  })),
  "idempotency-key": Schema.String.annotations({
    description: "Opaque caller-generated key, unique per organization and logical numbered-document operation.",
  }),
})

type Endpoint<N extends string, M extends HttpMethod, P, U, B, H, S, E1, R, RE> =
  HttpApiEndpoint.HttpApiEndpoint<N, M, P, U, B, H, S, E1, R, RE>
const retryAfterHeader = {
  description: "Cooldown remaining in whole seconds.", required: true,
  schema: { type: "integer", minimum: 1, maximum: 30 },
} as const
export const addRetryAfterHeader = (operation: Record<string, unknown>): Record<string, unknown> => {
  const responses = operation.responses as Readonly<Record<string, Readonly<Record<string, unknown>>>>
  const throttled = responses["429"]
  if (throttled === undefined) return operation
  const headers = throttled.headers as Readonly<Record<string, unknown>> | undefined
  return { ...operation, responses: { ...responses,
    "429": { ...throttled, headers: { ...headers, "Retry-After": retryAfterHeader } } } }
}
export const invoicingBase = <N extends string, M extends HttpMethod, P, U, B, H, S, E1, R, RE>(
  endpoint: Endpoint<N, M, P, U, B, H, S, E1, R, RE>,
) => endpoint.addError(E.PermissionDeniedError).addError(E.InvoicingInternalError)
  .addError(E.BusinessUnavailableError).addError(E.TooManyAttemptsError)
  .middleware(ApiAuthentication).annotate(OpenApi.Transform, addRetryAfterHeader)
export const documentsBase = <N extends string, M extends HttpMethod, P, U, B, H, S, E1, R, RE>(
  endpoint: Endpoint<N, M, P, U, B, H, S, E1, R, RE>,
) => endpoint.addError(E.DocumentsPermissionDeniedError).addError(E.DocumentsInternalError)
  .addError(E.BusinessUnavailableError).addError(E.TooManyAttemptsError)
  .middleware(ApiAuthentication).annotate(OpenApi.Transform, addRetryAfterHeader)
export const body = <N extends string, M extends HttpMethod, P, U, B, H, S, E1, R, RE>(
  endpoint: Endpoint<N, M, P, U, B, H, S, E1, R, RE>,
) => endpoint.setHeaders(csrfHeaders).addError(E.InvalidJsonError).addError(E.PayloadTooLargeError).addError(E.CsrfError)
export const idempotentBody = <N extends string, M extends HttpMethod, P, U, B, H, S, E1, R, RE>(
  endpoint: Endpoint<N, M, P, U, B, H, S, E1, R, RE>,
) => endpoint.setHeaders(idempotentHeaders).addError(E.InvalidJsonError).addError(E.PayloadTooLargeError).addError(E.CsrfError)
export const validation = <N extends string, M extends HttpMethod, P, U, B, H, S, E1, R, RE>(
  endpoint: Endpoint<N, M, P, U, B, H, S, E1, R, RE>,
) => endpoint.addError(E.ValidationError)
export const notFound = <N extends string, M extends HttpMethod, P, U, B, H, S, E1, R, RE>(
  endpoint: Endpoint<N, M, P, U, B, H, S, E1, R, RE>,
) => endpoint.addError(E.ResourceNotFoundError)
export const conflict = <N extends string, M extends HttpMethod, P, U, B, H, S, E1, R, RE>(
  endpoint: Endpoint<N, M, P, U, B, H, S, E1, R, RE>,
) => endpoint.addError(E.DomainConflictError)
