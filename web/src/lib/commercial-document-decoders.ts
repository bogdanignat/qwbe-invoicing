import { array, integer, nullableText, object, text, type Decoder } from "./model-decoder.ts"
import { decodeDraftLine, decodeVatBreakdown, optionalDocumentSource } from "./document-decoders.ts"
import {
  decodeBuyer, decodeIssuedIssuerCompanySnapshot, decodeIssuerSnapshot,
} from "./party-decoders.ts"
import type { IssuerCompanySnapshot } from "./party-models.ts"
import type { IssuedInvoice, IssuedInvoiceSummary, Proforma, ProformaSummary } from "./document-models.ts"

const decodeInvoiceWithIssuer = <Value extends IssuerCompanySnapshot>(
  input: unknown,
  decodeIssuer: Decoder<Value>,
): Omit<IssuedInvoice, "issuer"> & { readonly issuer: Value } => {
  const value = object(input)
  const source = optionalDocumentSource(value.source)
  return {
    actorId: text(value.actorId, "actorId"),
    id: text(value.id, "id"),
    draftId: nullableText(value.draftId, "draftId"),
    sourceProformaId: nullableText(value.sourceProformaId, "sourceProformaId"),
    ...(source === undefined ? {} : { source }),
    series: text(value.series, "series"),
    number: integer(value.number, "number"),
    issueDate: text(value.issueDate, "issueDate"),
    dueDate: nullableText(value.dueDate, "dueDate"),
    currency: text(value.currency, "currency"),
    notes: nullableText(value.notes, "notes"),
    issuer: decodeIssuer(value.issuer),
    customer: decodeBuyer(value.customer),
    lines: array(value.lines, decodeDraftLine, "lines"),
    vatBreakdown: array(value.vatBreakdown, decodeVatBreakdown, "vatBreakdown"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"),
    vatTotal: text(value.vatTotal, "vatTotal"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
    eFacturaStatus: text(value.eFacturaStatus, "eFacturaStatus"),
  }
}

export const decodeInvoice: Decoder<IssuedInvoice> = (input) =>
  decodeInvoiceWithIssuer(input, decodeIssuerSnapshot)
export const decodeInvoiceSummary: Decoder<IssuedInvoiceSummary> = (input) =>
  decodeInvoiceWithIssuer(input, decodeIssuedIssuerCompanySnapshot)

const decodeProformaWithIssuer = <Value extends IssuerCompanySnapshot>(
  input: unknown,
  decodeIssuer: Decoder<Value>,
): Omit<Proforma, "issuer"> & { readonly issuer: Value } => {
  const value = object(input)
  const source = optionalDocumentSource(value.source)
  return {
    actorId: text(value.actorId, "actorId"),
    id: text(value.id, "id"),
    sourceDraftId: nullableText(value.sourceDraftId, "sourceDraftId"),
    ...(source === undefined ? {} : { source }),
    organizationId: text(value.organizationId, "organizationId"),
    series: text(value.series, "series"),
    number: integer(value.number, "number"),
    issueDate: text(value.issueDate, "issueDate"),
    dueDate: nullableText(value.dueDate, "dueDate"),
    issuedAt: text(value.issuedAt, "issuedAt"),
    currency: text(value.currency, "currency"),
    notes: nullableText(value.notes, "notes"),
    issuer: decodeIssuer(value.issuer),
    customer: decodeBuyer(value.customer),
    lines: array(value.lines, decodeDraftLine, "lines"),
    vatBreakdown: array(value.vatBreakdown, decodeVatBreakdown, "vatBreakdown"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"),
    vatTotal: text(value.vatTotal, "vatTotal"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
    convertedDraftId: nullableText(value.convertedDraftId, "convertedDraftId"),
    convertedInvoiceId: nullableText(value.convertedInvoiceId, "convertedInvoiceId"),
  }
}

export const decodeProforma: Decoder<Proforma> = (input) =>
  decodeProformaWithIssuer(input, decodeIssuerSnapshot)
export const decodeProformaSummary: Decoder<ProformaSummary> = (input) =>
  decodeProformaWithIssuer(input, decodeIssuedIssuerCompanySnapshot)
