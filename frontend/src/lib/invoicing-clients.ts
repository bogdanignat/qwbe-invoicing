import { decodeCorrectionDocument, decodeIssuedInvoice } from "./document-snapshot-decoders.ts"
import { decodeInvoiceRegisterPage, type InvoiceRegisterRow } from "./invoice-register.ts"
import { encoded, paged } from "./client-paths.ts"
import type { BrowserTransport } from "./browser-transport.ts"
import type { CorrectionDocument, IssuedInvoice } from "./document-snapshot.ts"
import type { Page, PageRequest } from "./model-decoder.ts"

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
}

/**
 * The `accept` header is stated per document type rather than left to default.
 *
 * `transport.binary` otherwise asks for `application/octet-stream`, which is
 * not what either endpoint declares it produces — the PDF route answers
 * `application/pdf` and the e-Factura route `application/xml`.
 */
export const createInvoiceDocumentsClient = (transport: BrowserTransport): InvoiceDocumentsClient => ({
  getInvoice: async (id, signal) =>
    decodeIssuedInvoice(await transport.json(`/api/invoices/${encoded(id)}`, { signal })),
  getCorrection: async (id, signal) =>
    decodeCorrectionDocument(await transport.json(`/api/corrections/${encoded(id)}`, { signal })),
  /**
   * A PDF is rendered before it can be fetched, and rendering is a mutation:
   * it needs the session's CSRF token, while the byte fetch that follows is a
   * plain read. The XML has no such step — it is a pure function of the frozen
   * snapshot, so a single GET is the whole operation. There is no correction
   * PDF to ask for: the backend exposes only the correction's XML.
   */
  downloadInvoicePdf: async (id, csrfToken) => {
    await transport.json(`/api/invoices/${encoded(id)}/pdf`, { method: "POST", body: {}, csrfToken })
    return transport.binary(`/api/invoices/${encoded(id)}/pdf`, { accept: "application/pdf" })
  },
  downloadInvoiceEFactura: (id) =>
    transport.binary(`/api/invoices/${encoded(id)}/efactura.xml`, { accept: "application/xml" }),
  downloadCorrectionEFactura: (id) =>
    transport.binary(`/api/corrections/${encoded(id)}/efactura.xml`, { accept: "application/xml" }),
})
