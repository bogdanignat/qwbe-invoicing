import type { BrowserTransport } from "./browser-transport.ts"
import { encoded, paged } from "./client-paths.ts"
import type { Page, PageRequest } from "./model-decoder.ts"
import { decodeReceivedDetail, decodeReceivedFetch, decodeReceivedPage, decodeReceivedStatus } from "./received-decoders.ts"
import type { ReceivedDetail, ReceivedFetch, ReceivedStatus, ReceivedSummary } from "./received-models.ts"

/**
 * The received-invoice routes of the e-Factura plugin
 * (`kernel/api/http-endpoints-efactura-received.ts`). They exist only while the
 * plugin runs, so only a caller that checked the session's plugins uses this.
 * Asking for a fetch carries CSRF and needs no idempotency key: while one is
 * active, asking again answers that one.
 */
export interface EFacturaReceivedClient {
  readonly list: (page: PageRequest | undefined, signal: AbortSignal) => Promise<Page<ReceivedSummary>>
  readonly detail: (id: string, signal: AbortSignal) => Promise<ReceivedDetail>
  readonly archive: (id: string) => Promise<Blob>
  readonly status: (signal: AbortSignal) => Promise<ReceivedStatus>
  readonly requestFetch: (csrfToken: string) => Promise<ReceivedFetch>
}

export const receivedQueryKeys = {
  list: ["efactura", "received", "list"],
  status: ["efactura", "received", "status"],
  detail: (id: string) => ["efactura", "received", "detail", id] as const,
} as const

const BASE = "/api/efactura/received"

export const createEFacturaReceivedClient = (transport: BrowserTransport): EFacturaReceivedClient => ({
  list: async (page, signal) => decodeReceivedPage(await transport.json(paged(BASE, page), { signal })),
  detail: async (id, signal) => decodeReceivedDetail(await transport.json(`${BASE}/${encoded(id)}`, { signal })),
  archive: (id) => transport.binary(`${BASE}/${encoded(id)}/archive`, { accept: "application/zip" }),
  status: async (signal) => decodeReceivedStatus(await transport.json(`${BASE}/status`, { signal })),
  requestFetch: async (csrfToken) => decodeReceivedFetch(await transport.json(`${BASE}/fetches`, { method: "POST", body: {}, csrfToken })),
})
