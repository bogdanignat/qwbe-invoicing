import { efacturaPermissions } from "../connection/index.ts"

/**
 * Invoices received through the SPV, fetched only when a user asks: the fetch
 * request and its window, the coverage rule, and what is kept of each archive
 * once `received-ubl` has read it. The cube is pure: ANAF calls, the ZIP, the
 * dispatcher and storage are the host's. Required inside the e-Factura plugin, so it is on
 * exactly when e-Factura is.
 */
export const cube = {
  manifest: {
    name: "received",
    parent: "efactura",
    summary: "Invoices received through the SPV: fetches on request, their archives and what was read out of them",
    required: true,
    tables: [
      "efactura_received_fetches", "efactura_received_messages", "efactura_received_archives", "efactura_received_invoices",
      "efactura_received_unreadable", "efactura_received_coverage",
    ],
    requiresAuth: true,
    permissions: [{ name: efacturaPermissions("efactura").receive, roles: ["admin"] }],
  },
  create: () => ({ handlers: {} }),
}

export { receivedMigrations, type ReceivedMigration } from "./contracts/migrations.ts"
export {
  DOWNLOAD_RETRY_MS, FETCH_FAILURES, LISTABLE_DAYS, MAX_DOWNLOAD_ATTEMPTS, MAX_LIST_RETRIES, OVERLAP_MS, RECEIVED_TYPE, START_MARGIN_MS,
  advancesCoverage, fetchWindow, isReceivedInvoice, listable, listableFrom, retriable, type FetchWindow,
} from "./domain/fetching.ts"
export { interpretArchive, type Interpretation, type OpenedArchive, type ReceivedListing, type UnreadableReason } from "./domain/interpretation.ts"
export { createReceivedService, type ReceivedFailure, type ReceivedService, type Requested } from "./application/fetches.ts"
export type { FetchRecord, FetchState, NewFetch, ReceivedDependencies, ReceivedTransaction } from "./application/ports.ts"
