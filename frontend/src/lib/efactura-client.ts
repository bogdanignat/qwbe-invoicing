import type { BrowserTransport } from "./browser-transport.ts"
import { encoded } from "./client-paths.ts"
import { decodeAuthorizeUrl, decodeEFacturaConnection, type EFacturaConnection } from "./efactura-connection.ts"
import {
  decodeEFacturaCandidates, decodeEFacturaHistory, decodeEFacturaSubmission,
  type EFacturaCandidates, type EFacturaHistory, type EFacturaSubmission, type SubmittedKind,
} from "./efactura-submissions.ts"

/**
 * The e-Factura plugin's routes (`kernel/api/http-endpoints-efactura*.ts`).
 * They exist only while the plugin runs, so only a caller that checked the
 * session's plugins may use this client. Every write carries CSRF; none needs
 * an idempotency key: a submit or a resubmit answers the submission already
 * made (`200`), and a link is refused once the submission left `unknown`.
 */
export interface EFacturaClient {
  readonly connection: (signal: AbortSignal) => Promise<EFacturaConnection>
  readonly startConnection: (csrfToken: string) => Promise<string>
  readonly disconnect: (csrfToken: string) => Promise<EFacturaConnection>
  readonly history: (kind: SubmittedKind, documentId: string, signal: AbortSignal) => Promise<EFacturaHistory>
  readonly submit: (csrfToken: string, kind: SubmittedKind, documentId: string) => Promise<EFacturaSubmission>
  readonly submittedXml: (submissionId: string) => Promise<Blob>
  readonly anafResponse: (submissionId: string) => Promise<Blob>
  readonly candidates: (submissionId: string, page: number, signal: AbortSignal) => Promise<EFacturaCandidates>
  readonly link: (csrfToken: string, submissionId: string, uploadIndex: string) => Promise<EFacturaSubmission>
  readonly resubmit: (csrfToken: string, submissionId: string) => Promise<EFacturaSubmission>
}

/** The plugin's query keys: a write refreshes the document's history and its status in the register. */
export const efacturaQueryKeys = {
  connection: ["efactura", "connection"],
  history: (kind: SubmittedKind, documentId: string) => ["efactura", "history", kind, documentId] as const,
  candidates: (submissionId: string, page: number) => ["efactura", "candidates", submissionId, page] as const,
} as const

const documentPath = (kind: SubmittedKind, documentId: string): string =>
  `/api/${kind === "invoice" ? "invoices" : "corrections"}/${encoded(documentId)}/efactura`
const submissionPath = (submissionId: string): string => `/api/efactura/submissions/${encoded(submissionId)}`

export const createEFacturaClient = (transport: BrowserTransport): EFacturaClient => ({
  connection: async (signal) => decodeEFacturaConnection(await transport.json("/api/efactura/connection", { signal })),
  startConnection: async (csrfToken) =>
    decodeAuthorizeUrl(await transport.json("/api/efactura/connection/start", { method: "POST", body: {}, csrfToken })),
  disconnect: async (csrfToken) =>
    decodeEFacturaConnection(await transport.json("/api/efactura/connection", { method: "DELETE", csrfToken })),
  history: async (kind, documentId, signal) =>
    decodeEFacturaHistory(await transport.json(`${documentPath(kind, documentId)}/submissions`, { signal }), kind, documentId),
  submit: async (csrfToken, kind, documentId) =>
    decodeEFacturaSubmission(await transport.json(`${documentPath(kind, documentId)}/submission`, { method: "POST", body: {}, csrfToken })),
  submittedXml: (submissionId) => transport.binary(`${submissionPath(submissionId)}/xml`, { accept: "application/xml" }),
  anafResponse: (submissionId) => transport.binary(`${submissionPath(submissionId)}/response`, { accept: "application/zip" }),
  candidates: async (submissionId, page, signal) =>
    decodeEFacturaCandidates(await transport.json(`${submissionPath(submissionId)}/candidates?page=${String(page)}`, { signal })),
  link: async (csrfToken, submissionId, uploadIndex) => decodeEFacturaSubmission(await transport.json(
    `${submissionPath(submissionId)}/link`, { method: "POST", body: { uploadIndex, confirmed: true }, csrfToken })),
  resubmit: async (csrfToken, submissionId) => decodeEFacturaSubmission(await transport.json(
    `${submissionPath(submissionId)}/resubmit`, { method: "POST", body: { confirmed: true }, csrfToken })),
})
