import { HttpApiSchema } from "@effect/platform"
import { Schema } from "effect"

const optionalString = Schema.optional(Schema.String)
const nullableString = Schema.NullOr(Schema.String)
const optionalNullableString = Schema.optional(nullableString)

export const Address = Schema.Struct({
  countryCode: Schema.String,
  city: Schema.String,
  street: Schema.String,
  county: optionalString,
  postalCode: optionalString,
})

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

export const CustomerInput = Schema.Struct({
  partyType: Schema.Literal("company", "individual"),
  name: Schema.String,
  fiscalIdentifier: Schema.String,
  address: Address,
  defaultPaymentTermDays: Schema.optional(Schema.Int),
})

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
})

export const IssuerInput = Schema.Struct({
  name: Schema.String,
  fiscalIdentifier: Schema.String,
  address: Address,
  defaultCurrency: Schema.String,
  defaultPaymentTermDays: Schema.Int,
  vatConfigurations: Schema.Array(VatConfigurationInput),
})

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
})

export const DocumentSeries = Schema.Struct({
  organizationId: Schema.String,
  documentType: Schema.Literal("invoice", "proforma"),
  series: Schema.String,
})

export const UnitOfMeasure = Schema.Struct({ code: Schema.String, name: Schema.String })
export const DocumentSource = Schema.Struct({ app: Schema.String, kind: Schema.String, id: Schema.String })
export const SourceFilter = Schema.Struct({
  sourceApp: optionalString,
  sourceKind: optionalString,
  sourceId: optionalString,
})
export const PageQuery = Schema.Struct({
  limit: Schema.optional(Schema.NumberFromString.annotations({ description: "Page size, 1-200, default 100." })),
  cursor: Schema.optional(Schema.String.annotations({ description: "Opaque nextCursor of the previous page." })),
})
export const ListQuery = Schema.Struct({ ...SourceFilter.fields, ...PageQuery.fields })
const pageOf = <A, I, R>(item: Schema.Schema<A, I, R>) => Schema.Struct({ items: Schema.Array(item), nextCursor: Schema.NullOr(Schema.String) })

export const Customer = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  partyType: Schema.Literal("company", "individual"),
  name: Schema.String,
  fiscalIdentifier: Schema.String,
  address: Address,
  defaultPaymentTermDays: Schema.optional(Schema.Int),
  deletedAt: optionalString,
})

export const CustomerPage = pageOf(Customer)

export const ProductPresetInput = Schema.Struct({
  description: Schema.String,
  unitPrice: Schema.String,
  unitOfMeasure: UnitOfMeasure,
})

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
  source: Schema.optional(DocumentSource),
  series: Schema.String,
  issueDate: Schema.String,
  dueDate: nullableString,
  currency: Schema.String,
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
  source: Schema.optional(DocumentSource),
  series: Schema.String,
  number: Schema.Int,
  issueDate: Schema.String,
  dueDate: nullableString,
  issuedAt: Schema.String,
  currency: Schema.String,
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

const BuyerById = Schema.Struct({ customerId: Schema.String })
const InlineBuyer = Schema.Struct({ customer: Buyer })
export const DraftInput = Schema.Union(
  Schema.Struct({ customerId: Schema.String, source: Schema.optional(DocumentSource), series: Schema.String, issueDate: Schema.String, currency: optionalString, dueDate: optionalNullableString }),
  Schema.Struct({ customer: Buyer, source: Schema.optional(DocumentSource), series: Schema.String, issueDate: Schema.String, currency: optionalString, dueDate: optionalNullableString }),
)
export const UpdateDraftInput = Schema.Union(
  Schema.Struct({ ...BuyerById.fields, source: Schema.optional(Schema.NullOr(DocumentSource)), issueDate: Schema.String, dueDate: optionalNullableString }),
  Schema.Struct({ ...InlineBuyer.fields, source: Schema.optional(Schema.NullOr(DocumentSource)), issueDate: Schema.String, dueDate: optionalNullableString }),
)
export const DraftLineInput = Schema.Struct({
  description: Schema.String,
  quantity: Schema.String,
  unitPrice: Schema.String,
  unitOfMeasure: UnitOfMeasure,
  vatRateCode: Schema.String,
})
const AuthoringFields = { source: Schema.optional(DocumentSource), series: Schema.String, issueDate: Schema.String, dueDate: optionalNullableString,
  currency: Schema.Literal("RON"), lines: Schema.Array(DraftLineInput) }
export const AuthoringDocumentInput = Schema.Union(
  Schema.Struct({ ...BuyerById.fields, ...AuthoringFields }), Schema.Struct({ ...InlineBuyer.fields, ...AuthoringFields }),
)
export const AuthoringProformaInput = Schema.Union(
  Schema.Struct({ ...BuyerById.fields, ...AuthoringFields, proformaSeries: Schema.String }),
  Schema.Struct({ ...InlineBuyer.fields, ...AuthoringFields, proformaSeries: Schema.String }),
)

export const PaymentInput = Schema.Struct({
  amount: Schema.String,
  currency: Schema.String,
  paymentDate: Schema.String,
  method: Schema.String,
  externalReference: optionalString,
  note: optionalString,
})
export const PaymentStatus = Schema.Literal("unpaid", "partially_paid", "paid", "overpaid", "overdue")
export const Payment = Schema.Struct({
  id: Schema.String,
  invoiceId: Schema.String,
  organizationId: Schema.String,
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

export const CorrectionInput = Schema.Struct({ reason: Schema.String, issueDate: optionalString, source: Schema.optional(DocumentSource) })
export const Correction = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  originalInvoiceId: Schema.String,
  source: Schema.optional(DocumentSource),
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
  source: Schema.optional(DocumentSource),
  series: Schema.String,
  number: Schema.Int,
  issueDate: Schema.String,
  dueDate: nullableString,
  issuedAt: Schema.String,
  currency: Schema.String,
  issuer: Party,
  customer: Buyer,
  lines: Schema.Array(DraftLine),
  vatBreakdown: Schema.Array(VatBreakdown),
  totalExcludingVat: Schema.String,
  vatTotal: Schema.String,
  totalIncludingVat: Schema.String,
})
export const ProformaPage = pageOf(Proforma)
export const IssueProformaInput = Schema.Struct({ series: Schema.String })
export const EmptyInput = Schema.Struct({})
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
