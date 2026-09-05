import { Effect } from "effect"

import { apiBlob, apiRequest, type ApiFailure } from "./api.ts"
import {
  decodeCorrection, decodeCorrections, decodeCustomer, decodeCustomerPage, decodeDeleted, decodeDraft, decodeDraftPage,
  decodeDocumentSeries, decodeDocumentSeriesList, decodeInvoice, decodeInvoicePage, decodeIssuer, decodePaymentSummary,
  decodeProductPreset, decodeProductPresetPage, decodeProforma, decodeProformaPage, decodeUnitOfMeasures,
  type BuyerSnapshot, type CorrectionDocument, type Customer, type DocumentSeries, type DocumentSource, type DocumentType, type DraftInvoice, type IssuedInvoice, type Issuer, type PageRequest, type PaymentSummary, type ProductPreset, type Proforma, type UnitOfMeasure,
} from "./models.ts"

const ignored = (): undefined => undefined
const encoded = (value: string): string => encodeURIComponent(value)
const paged = (path: string, page: PageRequest | undefined): string => {
  const params = new URLSearchParams()
  if (page?.limit !== undefined) params.set("limit", String(page.limit))
  if (page?.cursor !== undefined) params.set("cursor", page.cursor)
  const query = params.toString()
  return query === "" ? path : `${path}?${query}`
}

export interface InvoiceBundle {
  readonly invoice: IssuedInvoice
  readonly paymentSummary: PaymentSummary
  readonly corrections: ReadonlyArray<CorrectionDocument>
}

export type CreateDocumentSeriesInput = {
  readonly documentType: DocumentType
  readonly series: string
}

export type CustomerInput = BuyerSnapshot & { readonly defaultPaymentTermDays?: number }
export type ProductPresetInput = Pick<ProductPreset, "description" | "unitPrice" | "unitOfMeasure">

type BuyerSource =
  | { readonly customerId: string; readonly customer?: never }
  | { readonly customer: BuyerSnapshot; readonly customerId?: never }

export type CreateDraftInput = BuyerSource & {
  readonly source?: DocumentSource
  readonly series: string
  readonly issueDate: string
  readonly currency?: "RON"
  readonly dueDate?: string | null
}

export type UpdateDraftInput = BuyerSource & {
  readonly source?: DocumentSource | null
  readonly issueDate: string
  readonly dueDate?: string | null
}

export interface DraftLineInput {
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  readonly vatRateCode: string
}

export type AuthoringDocumentInput = CreateDraftInput & {
  readonly currency: "RON"
  readonly lines: ReadonlyArray<DraftLineInput>
}

export type AuthoringProformaInput = AuthoringDocumentInput & { readonly proformaSeries: string }

export const invoicingClient = {
  listCustomers: (page?: PageRequest) => apiRequest(paged("/api/customers", page), decodeCustomerPage),
  createCustomer: (body: CustomerInput) => apiRequest("/api/customers", decodeCustomer, { method: "POST", body }),
  updateCustomer: (id: string, body: CustomerInput) => apiRequest(`/api/customers/${encoded(id)}`, decodeCustomer, { method: "PUT", body }),
  deleteCustomer: (id: string) => apiRequest(`/api/customers/${encoded(id)}`, decodeDeleted, { method: "DELETE" }),
  listProductPresets: (page?: PageRequest) => apiRequest(paged("/api/product-presets", page), decodeProductPresetPage),
  listUnitOfMeasures: () => apiRequest("/api/unit-of-measures", decodeUnitOfMeasures),
  createProductPreset: (body: ProductPresetInput) => apiRequest("/api/product-presets", decodeProductPreset, { method: "POST", body }),
  updateProductPreset: (id: string, body: ProductPresetInput) => apiRequest(`/api/product-presets/${encoded(id)}`, decodeProductPreset, { method: "PUT", body }),
  deleteProductPreset: (id: string) => apiRequest(`/api/product-presets/${encoded(id)}`, decodeDeleted, { method: "DELETE" }),
  listInvoices: (page?: PageRequest) => apiRequest(paged("/api/invoices", page), decodeInvoicePage),
  getIssuer: () => apiRequest("/api/issuer", decodeIssuer).pipe(
    Effect.catchAll((failure) => failure.status === 404 ? Effect.succeed(null) : Effect.fail(failure)),
  ),
  saveIssuer: (body: Readonly<Record<string, unknown>>) => apiRequest("/api/issuer", decodeIssuer, { method: "PUT", body }),
  listDocumentSeries: () => apiRequest("/api/document-series", decodeDocumentSeriesList),
  createDocumentSeries: (body: CreateDocumentSeriesInput) => apiRequest("/api/document-series", decodeDocumentSeries, { method: "POST", body }),
  createDraft: (body: CreateDraftInput) => apiRequest("/api/drafts", decodeDraft, { method: "POST", body }),
  listDrafts: (page?: PageRequest) => apiRequest(paged("/api/drafts", page), decodeDraftPage),
  getDraft: (id: string) => apiRequest(`/api/drafts/${encoded(id)}`, decodeDraft),
  updateDraft: (id: string, body: UpdateDraftInput) => apiRequest(`/api/drafts/${encoded(id)}`, decodeDraft, { method: "PUT", body }),
  deleteDraft: (id: string) => apiRequest(`/api/drafts/${encoded(id)}`, decodeDeleted, { method: "DELETE" }),
  addDraftLine: (id: string, body: DraftLineInput) => apiRequest(`/api/drafts/${encoded(id)}/lines`, decodeDraft, { method: "POST", body }),
  updateDraftLine: (id: string, lineId: string, body: DraftLineInput) => apiRequest(`/api/drafts/${encoded(id)}/lines/${encoded(lineId)}`, decodeDraft, { method: "PUT", body }),
  deleteDraftLine: (id: string, lineId: string) => apiRequest(`/api/drafts/${encoded(id)}/lines/${encoded(lineId)}`, decodeDraft, { method: "DELETE" }),
  issueDraft: (id: string, idempotencyKey: string) => apiRequest(`/api/drafts/${encoded(id)}/issue`, decodeInvoice, { method: "POST", body: {}, idempotencyKey }),
  issueInvoice: (body: AuthoringDocumentInput, idempotencyKey: string) => apiRequest("/api/invoices", decodeInvoice, { method: "POST", body, idempotencyKey }),
  issueDraftProforma: (draftId: string, series: string, idempotencyKey: string) => apiRequest(`/api/drafts/${encoded(draftId)}/proformas`, decodeProforma, { method: "POST", body: { series }, idempotencyKey }),
  issueProforma: (body: AuthoringProformaInput, idempotencyKey: string) => apiRequest("/api/proformas", decodeProforma, { method: "POST", body, idempotencyKey }),
  listProformas: (page?: PageRequest) => apiRequest(paged("/api/proformas", page), decodeProformaPage),
  getProforma: (id: string) => apiRequest(`/api/proformas/${encoded(id)}`, decodeProforma),
  issueInvoiceFromProforma: (id: string, idempotencyKey: string) => apiRequest(`/api/proformas/${encoded(id)}/invoice`, decodeInvoice, { method: "POST", body: {}, idempotencyKey }),
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
  recordPayment: (id: string, body: Readonly<Record<string, unknown>>, idempotencyKey: string) => apiRequest(`/api/invoices/${encoded(id)}/payments`, ignored, { method: "POST", body, idempotencyKey }),
  reversePayment: (id: string, paymentId: string, reason: string | undefined, idempotencyKey: string) => apiRequest(`/api/invoices/${encoded(id)}/payments/${encoded(paymentId)}/reversal`, ignored, { method: "POST", body: reason === undefined ? {} : { reason }, idempotencyKey }),
  createCorrection: (id: string, body: Readonly<Record<string, unknown>>, idempotencyKey: string) => apiRequest(`/api/invoices/${encoded(id)}/corrections`, decodeCorrection, { method: "POST", body, idempotencyKey }),
} as const

export type { Customer, DocumentSeries, DraftInvoice, IssuedInvoice, Issuer, PageRequest, ProductPreset, Proforma }
