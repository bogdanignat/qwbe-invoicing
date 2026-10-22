import type { CompanyLookupFailure, ProviderFailureReason } from "../../cubes/invoicing/company-lookup/index.ts"
import type { DocumentsFailure } from "../../cubes/invoicing/documents/index.ts"
import type { InvoicingFailure } from "../../cubes/invoicing/index.ts"
import type { VatRegistryUnavailable } from "../../cubes/invoicing/issuer/index.ts"
import type { PaymentsFailure } from "../../cubes/invoicing/payments/index.ts"
import { logInternalFailure } from "../failure-log.ts"

type Wire =
  | { readonly error: "AuthenticationRequired" | "OrganizationContextMissing" | "PermissionDenied" | "DocumentsPermissionDenied" }
  | { readonly error: "ValidationFailure"; readonly issues: ReadonlyArray<string> }
  | { readonly error: "ResourceNotFound" | "DocumentNotFound" | "ArtifactConflict" | "PersistenceFailure"
    | "DocumentPersistenceFailure" | "DocumentRenderingFailure" | "internal_failure" }
  | { readonly error: "DomainConflict"; readonly code: string }
  | { readonly error: "vat_registry_unavailable" }
  | { readonly error: "ProviderFailure"; readonly reason: ProviderFailureReason; readonly message: string; readonly retryAfterSeconds?: number }
export type ApiFailure = InvoicingFailure | PaymentsFailure | DocumentsFailure | CompanyLookupFailure | VatRegistryUnavailable
type WireTag = Wire["error"]
type Allowed<T extends WireTag> = Extract<Wire, { readonly error: T }> | { readonly error: "internal_failure" }

/** Shown as is by the forms: what happened, never what the provider said. */
const providerMessages: Readonly<Record<ProviderFailureReason, string>> = {
  quota_exceeded: "Cererile openapi.ro s-au terminat.",
  pending: "openapi.ro pregătește datele firmei; reîncearcă în câteva secunde.",
  auth_failed: "openapi.ro a refuzat cheia configurată.",
  unavailable: "Furnizorul de date despre firme nu răspunde acum.",
}

const toWire = (failure: ApiFailure): Wire => {
  switch (failure._tag) {
    case "ValidationFailure": return { error: "ValidationFailure", issues: failure.issues }
    case "DomainConflict": return { error: "DomainConflict", code: failure.code }
    case "RenderingFailure": return { error: "internal_failure" }
    case "VatRegistryUnavailable": return { error: "vat_registry_unavailable" }
    case "ProviderFailure": return { error: "ProviderFailure", reason: failure.reason, message: providerMessages[failure.reason],
      ...(failure.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: failure.retryAfterSeconds }) }
    case "AuthenticationRequired":
    case "OrganizationContextMissing":
    case "PermissionDenied":
    case "DocumentsPermissionDenied":
    case "ResourceNotFound":
    case "DocumentNotFound":
    case "ArtifactConflict":
    case "PersistenceFailure":
    case "DocumentPersistenceFailure":
    case "DocumentRenderingFailure": return { error: failure._tag }
  }
}
const unmappedReason = (failure: ApiFailure): string => [
  failure._tag, ..."code" in failure ? [failure.code] : [], ..."operation" in failure ? [failure.operation] : [],
  ..."message" in failure && typeof failure.message === "string" && failure.message !== "" ? [failure.message] : [],
].join(" ")
const serverFailures: ReadonlyArray<string> = ["PersistenceFailure", "DocumentPersistenceFailure", "DocumentRenderingFailure"]
const only = <T extends WireTag>(allowed: ReadonlyArray<T>) => (failure: ApiFailure): Allowed<T> => {
  const wire = toWire(failure)
  if (!(allowed as ReadonlyArray<string>).includes(wire.error)) {
    logInternalFailure({ kind: "unmapped_failure", reason: unmappedReason(failure) })
    return { error: "internal_failure" }
  }
  if (serverFailures.includes(wire.error)) logInternalFailure({ kind: "server_failure", reason: unmappedReason(failure) })
  return wire as Allowed<T>
}
type InvoicingBase = "AuthenticationRequired" | "OrganizationContextMissing" | "PermissionDenied" | "PersistenceFailure"
type DocumentsBase = "AuthenticationRequired" | "OrganizationContextMissing" | "DocumentsPermissionDenied"
  | "DocumentPersistenceFailure" | "DocumentRenderingFailure"
const invoicingBase: ReadonlyArray<InvoicingBase> = ["AuthenticationRequired", "OrganizationContextMissing", "PermissionDenied", "PersistenceFailure"]
const documentsBase: ReadonlyArray<DocumentsBase> = ["AuthenticationRequired", "OrganizationContextMissing", "DocumentsPermissionDenied",
  "DocumentPersistenceFailure", "DocumentRenderingFailure"]
export const errors = <T extends WireTag = never>(...extra: ReadonlyArray<T>) => only<InvoicingBase | T>([...invoicingBase, ...extra])
export const documentErrors = <T extends WireTag = never>(...extra: ReadonlyArray<T>) => only<DocumentsBase | T>([...documentsBase, ...extra])
