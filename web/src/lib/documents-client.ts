import { Effect } from "effect"
import { apiBlob, apiRequest } from "./api-transport.ts"
import { encoded, ignored, paged } from "./client-paths.ts"
import {
  decodeCorrection, decodeCorrections, decodeDraft, decodeInvoice, decodeInvoicePage,
  decodePaymentSummary, decodeProforma, decodeProformaPage, type PageRequest,
} from "./models.ts"
import type { AuthoringDocumentInput, AuthoringProformaInput, InvoiceBundleEffect } from "./invoicing-client-types.ts"

export const documentsClient = {
  listInvoices: (page?: PageRequest) => apiRequest(paged("/api/invoices", page), decodeInvoicePage),
  issueInvoice: (body: AuthoringDocumentInput, idempotencyKey: string) =>
    apiRequest("/api/invoices", decodeInvoice, { method: "POST", body, idempotencyKey }),
  issueProforma: (body: AuthoringProformaInput, idempotencyKey: string) =>
    apiRequest("/api/proformas", decodeProforma, { method: "POST", body, idempotencyKey }),
  listProformas: (page?: PageRequest) => apiRequest(paged("/api/proformas", page), decodeProformaPage),
  getProforma: (id: string) => apiRequest(`/api/proformas/${encoded(id)}`, decodeProforma),
  issueInvoiceFromProforma: (id: string, invoiceSeries: string, idempotencyKey: string) =>
    apiRequest(`/api/proformas/${encoded(id)}/invoice`, decodeInvoice, {
      method: "POST", body: { invoiceSeries }, idempotencyKey,
    }),
  createDraftFromProforma: (id: string, invoiceSeries: string, idempotencyKey: string) =>
    apiRequest(`/api/proformas/${encoded(id)}/draft-invoice`, decodeDraft, {
      method: "POST", body: { invoiceSeries }, idempotencyKey,
    }),
  getInvoiceBundle: (id: string): InvoiceBundleEffect => Effect.all({
    invoice: apiRequest(`/api/invoices/${encoded(id)}`, decodeInvoice),
    paymentSummary: apiRequest(`/api/invoices/${encoded(id)}/payments`, decodePaymentSummary),
    corrections: apiRequest(`/api/invoices/${encoded(id)}/corrections`, decodeCorrections),
  }, { concurrency: "unbounded" }),
  downloadInvoicePdf: (id: string) => apiRequest(
    `/api/invoices/${encoded(id)}/pdf`, ignored, { method: "POST", body: {} },
  ).pipe(Effect.zipRight(apiBlob(`/api/invoices/${encoded(id)}/pdf`))),
  downloadProformaPdf: (id: string) => apiRequest(
    `/api/proformas/${encoded(id)}/pdf`, ignored, { method: "POST", body: {} },
  ).pipe(Effect.zipRight(apiBlob(`/api/proformas/${encoded(id)}/pdf`))),
  // Unlike the PDF, there is nothing to render first: the XML is a function of
  // the frozen snapshot, so a single GET is the whole operation.
  downloadInvoiceEFactura: (id: string) => apiBlob(`/api/invoices/${encoded(id)}/efactura.xml`),
  recordPayment: (id: string, body: Readonly<Record<string, unknown>>, idempotencyKey: string) =>
    apiRequest(`/api/invoices/${encoded(id)}/payments`, ignored, {
      method: "POST", body, idempotencyKey,
    }),
  reversePayment: (
    id: string, paymentId: string, reason: string | undefined, idempotencyKey: string,
  ) => apiRequest(`/api/invoices/${encoded(id)}/payments/${encoded(paymentId)}/reversal`, ignored, {
    method: "POST", body: reason === undefined ? {} : { reason }, idempotencyKey,
  }),
  createCorrection: (
    id: string, body: Readonly<Record<string, unknown>>, idempotencyKey: string,
  ) => apiRequest(`/api/invoices/${encoded(id)}/corrections`, decodeCorrection, {
    method: "POST", body, idempotencyKey,
  }),
} as const
