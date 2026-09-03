import { Effect } from "effect"

import { apiBlob, apiRequest, type ApiFailure } from "./api.ts"
import {
  decodeCorrection, decodeCorrections, decodeCustomer, decodeCustomers, decodeDeleted, decodeDraft, decodeDrafts,
  decodeDocumentSeries, decodeDocumentSeriesList, decodeInvoice, decodeInvoices, decodeIssuer, decodePaymentSummary,
  decodeProforma, decodeProformas,
  type BuyerSnapshot, type CorrectionDocument, type Customer, type DocumentSeries, type DocumentType, type DraftInvoice, type IssuedInvoice, type Issuer, type PaymentSummary, type Proforma,
} from "./models.ts"

const ignored = (): undefined => undefined
const encoded = (value: string): string => encodeURIComponent(value)

export interface InvoiceBundle {
  readonly invoice: IssuedInvoice
  readonly paymentSummary: PaymentSummary
  readonly corrections: ReadonlyArray<CorrectionDocument>
}

export type CreateDocumentSeriesInput = {
  readonly documentType: DocumentType
  readonly series: string
}

type BuyerSource =
  | { readonly customerId: string; readonly customer?: never }
  | { readonly customer: BuyerSnapshot; readonly customerId?: never }

export type CreateDraftInput = BuyerSource & {
  readonly series: string
  readonly issueDate: string
  readonly currency?: "RON"
  readonly dueDate?: string | null
}

export type UpdateDraftInput = BuyerSource & {
  readonly issueDate: string
  readonly dueDate?: string | null
}

export interface DraftLineInput {
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly taxCode: string
}

export type AuthoringDocumentInput = CreateDraftInput & {
  readonly currency: "RON"
  readonly lines: ReadonlyArray<DraftLineInput>
}

export type AuthoringProformaInput = AuthoringDocumentInput & { readonly proformaSeries: string }

export const invoicingClient = {
  listCustomers: () => apiRequest("/api/customers", decodeCustomers),
  createCustomer: (body: Readonly<Record<string, unknown>>) => apiRequest("/api/customers", decodeCustomer, { method: "POST", body }),
  deleteCustomer: (id: string) => apiRequest(`/api/customers/${encoded(id)}`, decodeDeleted, { method: "DELETE" }),
  listInvoices: () => apiRequest("/api/invoices", decodeInvoices),
  getIssuer: () => apiRequest("/api/issuer", decodeIssuer).pipe(
    Effect.catchAll((failure) => failure.status === 404 ? Effect.succeed(null) : Effect.fail(failure)),
  ),
  saveIssuer: (body: Readonly<Record<string, unknown>>) => apiRequest("/api/issuer", decodeIssuer, { method: "PUT", body }),
  listDocumentSeries: () => apiRequest("/api/document-series", decodeDocumentSeriesList),
  createDocumentSeries: (body: CreateDocumentSeriesInput) => apiRequest("/api/document-series", decodeDocumentSeries, { method: "POST", body }),
  createDraft: (body: CreateDraftInput) => apiRequest("/api/drafts", decodeDraft, { method: "POST", body }),
  listDrafts: () => apiRequest("/api/drafts", decodeDrafts),
  getDraft: (id: string) => apiRequest(`/api/drafts/${encoded(id)}`, decodeDraft),
  updateDraft: (id: string, body: UpdateDraftInput) => apiRequest(`/api/drafts/${encoded(id)}`, decodeDraft, { method: "PUT", body }),
  deleteDraft: (id: string) => apiRequest(`/api/drafts/${encoded(id)}`, decodeDeleted, { method: "DELETE" }),
  addDraftLine: (id: string, body: DraftLineInput) => apiRequest(`/api/drafts/${encoded(id)}/lines`, decodeDraft, { method: "POST", body }),
  updateDraftLine: (id: string, lineId: string, body: DraftLineInput) => apiRequest(`/api/drafts/${encoded(id)}/lines/${encoded(lineId)}`, decodeDraft, { method: "PUT", body }),
  deleteDraftLine: (id: string, lineId: string) => apiRequest(`/api/drafts/${encoded(id)}/lines/${encoded(lineId)}`, decodeDraft, { method: "DELETE" }),
  issueDraft: (id: string) => apiRequest(`/api/drafts/${encoded(id)}/issue`, decodeInvoice, { method: "POST", body: {} }),
  issueInvoice: (body: AuthoringDocumentInput) => apiRequest("/api/invoices", decodeInvoice, { method: "POST", body }),
  issueDraftProforma: (draftId: string, series: string) => apiRequest(`/api/drafts/${encoded(draftId)}/proformas`, decodeProforma, { method: "POST", body: { series } }),
  issueProforma: (body: AuthoringProformaInput) => apiRequest("/api/proformas", decodeProforma, { method: "POST", body }),
  listProformas: () => apiRequest("/api/proformas", decodeProformas),
  getProforma: (id: string) => apiRequest(`/api/proformas/${encoded(id)}`, decodeProforma),
  issueInvoiceFromProforma: (id: string) => apiRequest(`/api/proformas/${encoded(id)}/invoice`, decodeInvoice, { method: "POST", body: {} }),
  getInvoiceBundle: (id: string): Effect.Effect<InvoiceBundle, ApiFailure> => Effect.all({
    invoice: apiRequest(`/api/invoices/${encoded(id)}`, decodeInvoice),
    paymentSummary: apiRequest(`/api/invoices/${encoded(id)}/payments`, decodePaymentSummary),
    corrections: apiRequest(`/api/invoices/${encoded(id)}/corrections`, decodeCorrections),
  }, { concurrency: "unbounded" }),
  downloadInvoicePdf: (id: string) => apiRequest(`/api/invoices/${encoded(id)}/pdf`, ignored, { method: "POST", body: {} }).pipe(
    Effect.zipRight(apiBlob(`/api/invoices/${encoded(id)}/pdf`)),
  ),
  downloadProformaPdf: (id: string) => apiRequest(`/api/proformas/${encoded(id)}/pdf`, ignored, { method: "POST", body: {} }).pipe(
    Effect.zipRight(apiBlob(`/api/proformas/${encoded(id)}/pdf`)),
  ),
  recordPayment: (id: string, body: Readonly<Record<string, unknown>>) => apiRequest(`/api/invoices/${encoded(id)}/payments`, ignored, { method: "POST", body }),
  createCorrection: (id: string, body: Readonly<Record<string, unknown>>) => apiRequest(`/api/invoices/${encoded(id)}/corrections`, decodeCorrection, { method: "POST", body }),
} as const

export type { Customer, DocumentSeries, DraftInvoice, IssuedInvoice, Issuer, Proforma }
