import { HttpApiSchema } from "@effect/platform"
import { Schema } from "effect"

import { optionalString } from "./schema-primitives.ts"

export const Deleted = Schema.Struct({ deleted: Schema.Literal(true) })
export const LoginInput = Schema.Struct({ token: Schema.String })
/** `plugins`: the optional plugins this installation runs, so the browser asks nothing of one that is off. */
export const AuthenticatedSession = Schema.Struct({
  authenticated: Schema.Literal(true), csrfToken: Schema.String, plugins: Schema.Array(Schema.Literal("payments", "efactura", "company-lookup")),
})
export const LoggedOutSession = Schema.Struct({ authenticated: Schema.Literal(false) })

const withStatus = <A, I, R>(status: number, schema: Schema.Schema<A, I, R>) =>
  schema.annotations(HttpApiSchema.annotations({ status }))
const tagged = <const Tag extends string>(status: number, tag: Tag) =>
  withStatus(status, Schema.Struct({ error: Schema.Literal(tag) }))
export const ValidationError = withStatus(400,
  Schema.Struct({ error: Schema.Literal("ValidationFailure"), issues: Schema.Array(Schema.String) }))
export const InvalidJsonError = tagged(400, "invalid_json")
export const InvalidCredentialsRequestError = tagged(400, "invalid_credentials")
export const AuthenticationRequiredError = tagged(401, "AuthenticationRequired")
export const InvalidCredentialsError = tagged(401, "invalid_credentials")
export const PermissionDeniedError = tagged(403, "PermissionDenied")
export const DocumentsPermissionDeniedError = tagged(403, "DocumentsPermissionDenied")
export const CsrfError = tagged(403, "csrf_validation_failed")
export const OriginForbiddenError = tagged(403, "origin_not_allowed")
export const ResourceNotFoundError = tagged(404, "ResourceNotFound")
export const DocumentNotFoundError = tagged(404, "DocumentNotFound")
// `message` only where it is written for a person (a taken article code); every other conflict is named by its code.
export const DomainConflictError = withStatus(409, Schema.Struct({
  error: Schema.Literal("DomainConflict"), code: Schema.String, message: optionalString,
}))
export const ArtifactConflictError = tagged(409, "ArtifactConflict")
export const VatRegistryUnavailableError = Schema.Struct({ error: Schema.Literal("vat_registry_unavailable") }).annotations(
  HttpApiSchema.annotations({ status: 503, description: "The ANAF VAT registry did not answer; the fiscal change was not saved. Retry later." }),
)
export const PayloadTooLargeError = tagged(413, "request_body_too_large")
export const TooManyAttemptsError = Schema.Struct({ error: Schema.Literal("too_many_attempts") }).annotations(
  HttpApiSchema.annotations({ status: 429, description: "Authentication cooldown is active. Retry-After is an integer delay of 1-30 seconds." }),
)
export const InvoicingInternalError = Schema.Union(tagged(500, "PersistenceFailure"), tagged(500, "internal_failure"))
export const DocumentsInternalError = Schema.Union(
  tagged(500, "DocumentPersistenceFailure"), tagged(500, "DocumentRenderingFailure"), tagged(500, "internal_failure"),
)
export const SessionInternalError = tagged(500, "internal_failure")
export const BusinessUnavailableError = Schema.Union(tagged(503, "OrganizationContextMissing"), tagged(503, "not_ready"))
export const ReadinessError = tagged(503, "not_ready")
