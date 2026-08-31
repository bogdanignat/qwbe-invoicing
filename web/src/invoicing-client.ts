import { Effect } from "effect"

import { apiBlob, apiRequest, type ApiFailure } from "./api.ts"
import {
  decodeCorrection, decodeCorrections, decodeCustomer, decodeCustomers, decodeDeleted, decodeDraft,
  decodeInvoice, decodeInvoices, decodeIssuer, decodePaymentSummary,
  type CorrectionDocument, type Customer, type DraftInvoice, type IssuedInvoice, type Issuer, type PaymentSummary,
} from "./models.ts"

const ignored = (): undefined => undefined
const encoded = (value: string): string => encodeURIComponent(value)

export interface InvoiceBundle {
  readonly invoice: IssuedInvoice
  readonly paymentSummary: PaymentSummary
  readonly corrections: ReadonlyArray<CorrectionDocument>
}

export const invoicingClient = {
  listCustomers: () => apiRequest("/api/customers", decodeCustomers),
  createCustomer: (body: Readonly<Record<string, unknown>>) => apiRequest("/api/customers", decodeCustomer, { method: "POST", body }),
  deleteCustomer: (id: string) => apiRequest(`/api/customers/${encoded(id)}`, decodeDeleted, { method: "DELETE" }),
  listInvoices: () => apiRequest("/api/invoices", decodeInvoices),
  getIssuer: () => apiRequest("/api/issuer", decodeIssuer).pipe(
    Effect.catchAll((failure) => failure.status === 404 ? Effect.succeed(null) : Effect.fail(failure)),
  ),
  saveIssuer: (body: Readonly<Record<string, unknown>>) => apiRequest("/api/issuer", decodeIssuer, { method: "PUT", body }),
  createDraft: (body: Readonly<Record<string, unknown>>) => apiRequest("/api/drafts", decodeDraft, { method: "POST", body }),
  getDraft: (id: string) => apiRequest(`/api/drafts/${encoded(id)}`, decodeDraft),
  addDraftLine: (id: string, body: Readonly<Record<string, unknown>>) => apiRequest(`/api/drafts/${encoded(id)}/lines`, decodeDraft, { method: "POST", body }),
  issueDraft: (id: string) => apiRequest(`/api/drafts/${encoded(id)}/issue`, decodeInvoice, { method: "POST", body: {} }),
  getInvoiceBundle: (id: string): Effect.Effect<InvoiceBundle, ApiFailure> => Effect.all({
    invoice: apiRequest(`/api/invoices/${encoded(id)}`, decodeInvoice),
    paymentSummary: apiRequest(`/api/invoices/${encoded(id)}/payments`, decodePaymentSummary),
    corrections: apiRequest(`/api/invoices/${encoded(id)}/corrections`, decodeCorrections),
  }, { concurrency: "unbounded" }),
  deleteInvoice: (id: string) => apiRequest(`/api/invoices/${encoded(id)}`, decodeDeleted, { method: "DELETE" }),
  downloadInvoicePdf: (id: string) => apiRequest(`/api/invoices/${encoded(id)}/pdf`, ignored, { method: "POST", body: {} }).pipe(
    Effect.zipRight(apiBlob(`/api/invoices/${encoded(id)}/pdf`)),
  ),
  recordPayment: (id: string, body: Readonly<Record<string, unknown>>) => apiRequest(`/api/invoices/${encoded(id)}/payments`, ignored, { method: "POST", body }),
  createCorrection: (id: string, body: Readonly<Record<string, unknown>>) => apiRequest(`/api/invoices/${encoded(id)}/corrections`, decodeCorrection, { method: "POST", body }),
} as const

export type { Customer, DraftInvoice, IssuedInvoice, Issuer }
