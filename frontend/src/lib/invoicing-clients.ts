import { decodeCorrectionDocument, decodeIssuedInvoice } from "./document-snapshot-decoders.ts"
import { decodeInvoiceRegisterPage, type InvoiceRegisterRow } from "./invoice-register.ts"
import { encoded, paged } from "./client-paths.ts"
import { array, type Page, type PageRequest } from "./model-decoder.ts"
import { readableWrite } from "./unreadable-answer.ts"
import type { BrowserTransport } from "./browser-transport.ts"
import type { CorrectionDocument, CorrectionInput, IssuedInvoice } from "./document-snapshot.ts"

/**
 * The transport is an argument, not an import.
 *
 * A session owns its transport: every request it sends carries the epoch that
 * session started in, and that is what lets a late `401` be attributed to the
 * session it belongs to. A client that reached for a module-level singleton
 * would send requests no session owns, so the client is built from whatever
 * transport the caller is authenticated through and the hooks supply the one
 * held by `AuthContext`.
 */
export interface InvoiceRegisterClient {
  readonly list: (page: PageRequest | undefined, signal: AbortSignal) => Promise<Page<InvoiceRegisterRow>>
}

export const createInvoiceRegisterClient = (transport: BrowserTransport): InvoiceRegisterClient => ({
  list: async (page, signal) =>
    decodeInvoiceRegisterPage(await transport.json(paged("/api/invoice-register", page), { signal })),
})

export interface InvoiceDocumentsClient {
  readonly getInvoice: (id: string, signal: AbortSignal) => Promise<IssuedInvoice>
  readonly getCorrection: (id: string, signal: AbortSignal) => Promise<CorrectionDocument>
  readonly downloadInvoicePdf: (id: string, csrfToken: string) => Promise<Blob>
  readonly downloadInvoiceEFactura: (id: string) => Promise<Blob>
  readonly downloadCorrectionEFactura: (id: string) => Promise<Blob>
  readonly downloadCorrectionPdf: (id: string) => Promise<Blob>
  readonly listCorrections: (invoiceId: string, signal: AbortSignal) => Promise<ReadonlyArray<CorrectionDocument>>
  readonly createCorrection: (csrfToken: string, invoiceId: string, body: CorrectionInput, idempotencyKey: string) => Promise<CorrectionDocument>
  /** The stored body, sent as it was sent: a replay is never rebuilt from the form. */
  readonly replayCorrection: (csrfToken: string, invoiceId: string, body: unknown, idempotencyKey: string) => Promise<CorrectionDocument>
}

/**
 * The `accept` header is stated per document type rather than left to default.
 *
 * `transport.binary` otherwise asks for `application/octet-stream`, which is
 * not what either endpoint declares it produces — the PDF route answers
 * `application/pdf` and the e-Factura route `application/xml`.
 */
export const createInvoiceDocumentsClient = (transport: BrowserTransport): InvoiceDocumentsClient => {
  /**
   * Issuing a storno is a fiscal write settled by idempotency key: it carries the
   * CSRF token and the key, and passes through `readableWrite`, so an answer that
   * arrived but could not be read stays an unknown outcome. A stored body that is
   * missing is sent as `{}`, exactly as in `drafts-client.ts`.
   */
  const postCorrection = (csrfToken: string, invoiceId: string, body: unknown, idempotencyKey: string) =>
    readableWrite(transport.json(`/api/invoices/${encoded(invoiceId)}/corrections`, {
      csrfToken, method: "POST", body: body ?? {}, idempotencyKey,
    }).then(decodeCorrectionDocument))
  return {
    getInvoice: async (id, signal) =>
      decodeIssuedInvoice(await transport.json(`/api/invoices/${encoded(id)}`, { signal })),
    getCorrection: async (id, signal) =>
      decodeCorrectionDocument(await transport.json(`/api/corrections/${encoded(id)}`, { signal })),
    /**
     * A PDF is rendered before it can be fetched, and rendering is a mutation:
     * it needs the session's CSRF token, while the byte fetch that follows is a
     * plain read. The XML has no such step — it is a pure function of the frozen
     * snapshot, so a single GET is the whole operation. A correction's PDF is the
     * same kind of read: the backend renders it on request from the immutable
     * correction, with nothing stored and nothing to render first.
     */
    downloadInvoicePdf: async (id, csrfToken) => {
      await transport.json(`/api/invoices/${encoded(id)}/pdf`, { method: "POST", body: {}, csrfToken })
      return transport.binary(`/api/invoices/${encoded(id)}/pdf`, { accept: "application/pdf" })
    },
    downloadInvoiceEFactura: (id) =>
      transport.binary(`/api/invoices/${encoded(id)}/efactura.xml`, { accept: "application/xml" }),
    downloadCorrectionEFactura: (id) =>
      transport.binary(`/api/corrections/${encoded(id)}/efactura.xml`, { accept: "application/xml" }),
    downloadCorrectionPdf: (id) =>
      transport.binary(`/api/corrections/${encoded(id)}/pdf`, { accept: "application/pdf" }),
    listCorrections: async (invoiceId, signal) => array(
      await transport.json(`/api/invoices/${encoded(invoiceId)}/corrections`, { signal }),
      decodeCorrectionDocument, "corrections",
    ),
    createCorrection: postCorrection,
    replayCorrection: postCorrection,
  }
}
