import { HttpApiSchema } from "@effect/platform"
import { Schema } from "effect"

import type { BuyerSource } from "../cube/invoicing/index.ts"

const optional = <S extends Schema.Schema.All>(schema: S) => Schema.optionalWith(schema, { exact: true })
const optionalString = optional(Schema.String)
const nullableString = Schema.NullOr(Schema.String)
const optionalNullableString = optional(nullableString)
const bodyObject = { message: () => "request body must be a JSON object" }
const FiscalIdentifierInput = Schema.transform(Schema.String, Schema.String, {
  strict: true, decode: (value) => value.trim().toUpperCase(), encode: (value) => value,
})

// Free-form document remarks: newlines allowed for paragraphs, every other
// control character rejected. Mirrors validateDocumentNotes in the cube.
const DocumentNotes = Schema.NullOr(Schema.String).pipe(
  // One filter is intentional: chained refinements stop at the first failure.
  Schema.filter((value): ReadonlyArray<Schema.FilterIssue> => {
    if (value === null) return []
    const issues: Array<Schema.FilterIssue> = []
    if (value.trim().length === 0) issues.push({ path: [], message: "notes is required" })
    if (value !== value.trim()) issues.push({ path: [], message: "notes must not have surrounding whitespace" })
    if (value.length > 500) issues.push({ path: [], message: "notes must be at most 500 characters" })
    if (/(?!\n)[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) issues.push({ path: [], message: "notes must not contain control characters" })
    return issues
  }, {
    description: "1-500 characters, no surrounding whitespace or control characters except LF newlines.",
    jsonSchema: { anyOf: [{ type: "string", minLength: 1, maxLength: 500 }, { type: "null" }] },
  }),
)
const optionalNullableNotes = optional(DocumentNotes)

export const Address = Schema.Struct({
  countryCode: Schema.String,
  city: Schema.String,
  street: Schema.String,
  county: optionalString,
  postalCode: optionalString,
}).annotations(bodyObject)

export const Party = Schema.Struct({
  name: Schema.String,
  fiscalIdentifier: Schema.String,
  address: Address,
})

export const Buyer = Schema.Struct({
  partyType: Schema.Literal("company", "individual"),
  name: Schema.String,
  fiscalIdentifier: Schema.String,
  address: Address,
})
const BuyerInput = Schema.Struct({ ...Buyer.fields, fiscalIdentifier: FiscalIdentifierInput }).annotations(bodyObject)

export const CustomerInput = Schema.Struct({
  ...BuyerInput.fields,
  defaultPaymentTermDays: optional(Schema.Int),
}).annotations(bodyObject)

export const VatConfiguration = Schema.Struct({
  code: Schema.String,
  rate: Schema.String,
  effectiveFrom: Schema.String,
  effectiveTo: optionalString,
})

const VatConfigurationInput = Schema.Struct({
  code: Schema.String,
  rate: Schema.String,
  effectiveFrom: Schema.String,
  effectiveTo: optionalString,
}).annotations(bodyObject)

export const IssuerInput = Schema.Struct({
  name: Schema.String,
  fiscalIdentifier: FiscalIdentifierInput,
  address: Address,
  defaultCurrency: Schema.String,
  defaultPaymentTermDays: Schema.Int,
  vatConfigurations: Schema.Array(VatConfigurationInput),
}).annotations(bodyObject)

export const Issuer = Schema.Struct({
  name: Schema.String,
  fiscalIdentifier: Schema.String,
  address: Address,
  organizationId: Schema.String,
  defaultCurrency: Schema.String,
  defaultPaymentTermDays: Schema.Int,
  vatConfigurations: Schema.Array(VatConfiguration),
})

export const DocumentSeriesInput = Schema.Struct({
  documentType: Schema.Literal("invoice", "proforma"),
  series: Schema.String,
}).annotations(bodyObject)

export const DocumentSeries = Schema.Struct({
  organizationId: Schema.String,
  documentType: Schema.Literal("invoice", "proforma"),
  series: Schema.String,
})

export const UnitOfMeasure = Schema.Struct({ code: Schema.String, name: Schema.String }).annotations(bodyObject)
export const DocumentSource = Schema.Struct({ app: Schema.String, kind: Schema.String, id: Schema.String }).annotations(bodyObject)
const SourceQueryFields = Schema.Struct({
  sourceApp: optionalString,
  sourceKind: optionalString,
  sourceId: optionalString,
})
const requireCompleteSource = <A extends Schema.Schema.Type<typeof SourceQueryFields>, I, R>(schema: Schema.Schema<A, I, R>) =>
  schema.pipe(Schema.filter((input): input is A & (
    { readonly sourceApp: string, readonly sourceKind: string, readonly sourceId: string } |
    { readonly sourceApp?: never, readonly sourceKind?: never, readonly sourceId?: never }
  ) => {
    const values = [input.sourceApp, input.sourceKind, input.sourceId]
    return values.every((value) => value === undefined) || values.every((value) => value !== undefined)
  }, { message: () => "sourceApp, sourceKind, and sourceId must be supplied exactly once and together" }))
export const SourceFilter = SourceQueryFields.pipe(requireCompleteSource)
const PageLimit = Schema.String.pipe(
  Schema.pattern(/^\d{1,6}$/, { message: () => "limit must be an integer" }),
  Schema.transform(Schema.Number, { strict: true, decode: Number, encode: String }),
).annotations({ description: "Page size, 1-200, default 100." })
export const PageQuery = Schema.Struct({
  limit: optional(PageLimit),
  cursor: optional(Schema.String.annotations({ description: "Opaque nextCursor of the previous page." })),
})
export const ListQuery = Schema.Struct({ ...SourceQueryFields.fields, ...PageQuery.fields }).pipe(requireCompleteSource)
const pageOf = <A, I, R>(item: Schema.Schema<A, I, R>) => Schema.Struct({ items: Schema.Array(item), nextCursor: Schema.NullOr(Schema.String) })

export const Customer = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  partyType: Schema.Literal("company", "individual"),
  name: Schema.String,
  fiscalIdentifier: Schema.String,
  address: Address,
  defaultPaymentTermDays: optional(Schema.Int),
  deletedAt: optionalString,
})

export const CustomerPage = pageOf(Customer)

export const ProductPresetInput = Schema.Struct({
  description: Schema.String,
  unitPrice: Schema.String,
  unitOfMeasure: UnitOfMeasure,
}).annotations(bodyObject)

export const ProductPreset = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  description: Schema.String,
  unitPrice: Schema.String,
  unitOfMeasure: UnitOfMeasure,
})

export const DraftLine = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  quantity: Schema.String,
  unitPrice: Schema.String,
  unitOfMeasure: UnitOfMeasure,
  vatRateCode: Schema.String,
  vatRate: Schema.String,
  totalExcludingVat: Schema.String,
  vatAmount: Schema.String,
  totalIncludingVat: Schema.String,
})

export const VatBreakdown = Schema.Struct({
  code: Schema.String,
  rate: Schema.String,
  vatBaseAmount: Schema.String,
  vatAmount: Schema.String,
})

export const ProductPresetPage = pageOf(ProductPreset)

export const DraftInvoice = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  customer: Buyer,
  customerId: optionalString,
  source: optional(DocumentSource),
  series: Schema.String,
  issueDate: Schema.String,
  dueDate: nullableString,
  currency: Schema.String,
  notes: DocumentNotes,
  status: Schema.Literal("draft", "issued", "proforma_issued"),
  lines: Schema.Array(DraftLine),
  vatBreakdown: Schema.Array(VatBreakdown),
  totalExcludingVat: Schema.String,
  vatTotal: Schema.String,
  totalIncludingVat: Schema.String,
})

export const DraftInvoicePage = pageOf(DraftInvoice)

export const IssuedInvoice = Schema.Struct({
  id: Schema.String,
  draftId: nullableString,
  sourceProformaId: nullableString,
  organizationId: Schema.String,
  source: optional(DocumentSource),
  series: Schema.String,
  number: Schema.Int,
  issueDate: Schema.String,
  dueDate: nullableString,
  issuedAt: Schema.String,
  currency: Schema.String,
  notes: DocumentNotes,
  issuer: Party,
  customer: Buyer,
  lines: Schema.Array(DraftLine),
  vatBreakdown: Schema.Array(VatBreakdown),
  totalExcludingVat: Schema.String,
  vatTotal: Schema.String,
  totalIncludingVat: Schema.String,
  eFacturaStatus: Schema.Literal("not_sent", "pending", "sent", "accepted", "rejected"),
})

export const IssuedInvoicePage = pageOf(IssuedInvoice)

const BuyerSelection = Schema.Struct({ customerId: optionalString, customer: optional(BuyerInput) })
const requireBuyer = <A extends Schema.Schema.Type<typeof BuyerSelection>, I, R>(schema: Schema.Schema<A, I, R>) =>
  schema.annotations({ description: "Exactly one of customerId or customer is required." }).pipe(
    Schema.filter((input): input is A & BuyerSource => (input.customerId !== undefined) !== (input.customer !== undefined), {
      message: () => "exactly one of customerId or customer is required",
    }),
  )
export const DraftInput = Schema.Struct({
  ...BuyerSelection.fields, source: optional(DocumentSource), series: Schema.String, issueDate: Schema.String,
  currency: optionalString, dueDate: optionalNullableString, notes: optionalNullableNotes,
}).annotations(bodyObject).pipe(requireBuyer)
export const UpdateDraftInput = Schema.Struct({
  ...BuyerSelection.fields, source: optional(Schema.NullOr(DocumentSource)), issueDate: Schema.String,
  dueDate: optionalNullableString, notes: optionalNullableNotes,
}).annotations(bodyObject).pipe(requireBuyer)
export const DraftLineInput = Schema.Struct({
  description: Schema.String,
  quantity: Schema.String,
  unitPrice: Schema.String,
  unitOfMeasure: UnitOfMeasure,
  vatRateCode: Schema.String,
}).annotations(bodyObject)
const AuthoringFields = { ...BuyerSelection.fields, source: optional(DocumentSource), series: Schema.String, issueDate: Schema.String, dueDate: optionalNullableString,
  currency: Schema.Literal("RON"), notes: optionalNullableNotes, lines: Schema.Array(DraftLineInput) }
export const AuthoringDocumentInput = Schema.Struct(AuthoringFields).annotations(bodyObject).pipe(requireBuyer)
export const AuthoringProformaInput = Schema.Struct({ ...AuthoringFields, proformaSeries: Schema.String }).annotations(bodyObject).pipe(requireBuyer)

export const PaymentInput = Schema.Struct({
  amount: Schema.String,
  currency: Schema.String,
  paymentDate: Schema.String,
  method: Schema.String,
  externalReference: optionalString,
  note: optionalString,
}).annotations(bodyObject)
export const PaymentStatus = Schema.Literal("unpaid", "partially_paid", "paid", "overpaid", "overdue")
export const ReversalInput = Schema.Struct({ reason: optionalString }).annotations(bodyObject)
export const Payment = Schema.Struct({
  id: Schema.String,
  invoiceId: Schema.String,
  organizationId: Schema.String,
  kind: Schema.Literal("payment", "reversal"),
  reversesPaymentId: optionalString,
  amount: Schema.String,
  currency: Schema.String,
  paymentDate: Schema.String,
  method: Schema.String,
  externalReference: optionalString,
  note: optionalString,
  actorId: Schema.String,
  createdAt: Schema.String,
})
export const RecordPaymentResult = Schema.Struct({
  payment: Payment,
  status: PaymentStatus,
  paidAmount: Schema.String,
  remainingAmount: Schema.String,
})
export const PaymentSummary = Schema.Struct({
  invoiceId: Schema.String,
  status: PaymentStatus,
  paidAmount: Schema.String,
  remainingAmount: Schema.String,
  payments: Schema.Array(Payment),
})

export const CorrectionInput = Schema.Struct({ reason: Schema.String, issueDate: optionalString, source: optional(DocumentSource) }).annotations(bodyObject)
export const Correction = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  originalInvoiceId: Schema.String,
  source: optional(DocumentSource),
  fiscalYear: Schema.Int,
  series: Schema.String,
  number: Schema.Int,
  issueDate: Schema.String,
  issuedAt: Schema.String,
  reason: Schema.String,
  currency: Schema.String,
  issuer: Party,
  customer: Buyer,
  lines: Schema.Array(DraftLine),
  vatBreakdown: Schema.Array(VatBreakdown),
  totalExcludingVat: Schema.String,
  vatTotal: Schema.String,
  totalIncludingVat: Schema.String,
})

export const Artifact = Schema.Struct({
  invoiceId: Schema.String,
  organizationId: Schema.String,
  objectKey: Schema.String,
  sha256: Schema.String,
  byteLength: Schema.Int,
  mediaType: Schema.Literal("application/pdf"),
  templateVersion: Schema.String,
  generatedAt: Schema.String,
})
export const Proforma = Schema.Struct({
  id: Schema.String,
  sourceDraftId: nullableString,
  invoiceSeries: Schema.String,
  convertedDraftId: nullableString,
  convertedInvoiceId: nullableString,
  organizationId: Schema.String,
  source: optional(DocumentSource),
  series: Schema.String,
  number: Schema.Int,
  issueDate: Schema.String,
  dueDate: nullableString,
  issuedAt: Schema.String,
  currency: Schema.String,
  notes: DocumentNotes,
  issuer: Party,
  customer: Buyer,
  lines: Schema.Array(DraftLine),
  vatBreakdown: Schema.Array(VatBreakdown),
  totalExcludingVat: Schema.String,
  vatTotal: Schema.String,
  totalIncludingVat: Schema.String,
})
export const ProformaPage = pageOf(Proforma)
export const IssueProformaInput = Schema.Struct({ series: Schema.String }).annotations(bodyObject)
// Effect's empty Struct also accepts primitives and arrays; retain the JSON-object
// contract here and discard all fields just like the other request schemas.
export const EmptyInput = Schema.Struct({}).annotations(bodyObject).pipe(
  Schema.filter((value) => typeof value === "object" && !Array.isArray(value), { ...bodyObject, jsonSchema: { type: "object" } }),
  Schema.transform(Schema.Struct({}), { strict: true, decode: (): Record<string, never> => ({}), encode: () => ({}) }),
)
export const ProformaArtifact = Schema.Struct({
  proformaId: Schema.String,
  organizationId: Schema.String,
  objectKey: Schema.String,
  sha256: Schema.String,
  byteLength: Schema.Int,
  mediaType: Schema.Literal("application/pdf"),
  templateVersion: Schema.String,
  generatedAt: Schema.String,
})
export const Pdf = HttpApiSchema.Uint8Array({ contentType: "application/pdf" })
export const Deleted = Schema.Struct({ deleted: Schema.Literal(true) })
export const LoginInput = Schema.Struct({ token: Schema.String })
export const AuthenticatedSession = Schema.Struct({ authenticated: Schema.Literal(true), csrfToken: Schema.String })
export const LoggedOutSession = Schema.Struct({ authenticated: Schema.Literal(false) })

const errorUnion = (status: number, ...members: ReadonlyArray<Schema.Schema.Any>) =>
  Schema.Union(...members.map((member) => member.annotations(HttpApiSchema.annotations({ status }))))
const tagged = (status: number, ...tags: ReadonlyArray<string>) =>
  errorUnion(status, ...tags.map((error) => Schema.Struct({ error: Schema.Literal(error) })))
export const ValidationError = errorUnion(
  400,
  Schema.Struct({ error: Schema.Literal("ValidationFailure"), issues: Schema.Array(Schema.String) }),
)
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
export const DomainConflictError = errorUnion(
  409,
  Schema.Struct({ error: Schema.Literal("DomainConflict"), code: Schema.String }),
)
export const ArtifactConflictError = tagged(409, "ArtifactConflict")
export const PayloadTooLargeError = tagged(413, "request_body_too_large")
export const InvoicingInternalError = tagged(500, "PersistenceFailure", "internal_failure")
export const DocumentsInternalError = tagged(500, "DocumentPersistenceFailure", "DocumentRenderingFailure", "internal_failure")
export const SessionInternalError = tagged(500, "internal_failure")
export const BusinessUnavailableError = tagged(503, "OrganizationContextMissing", "not_ready")
export const ReadinessError = tagged(503, "not_ready")
