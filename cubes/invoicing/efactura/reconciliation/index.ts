import { efacturaPermissions } from "../connection/index.ts"

/**
 * Reconciliation of `unknown` e-Factura submissions: the candidates ANAF lists
 * for the submission's CIF and window, linking an index that list shows, and
 * resubmitting on the explicit confirmation that ANAF may then hold the
 * document twice. Every step is the user's; nothing is linked or sent again on
 * its own. It owns no table: it moves the submissions of `submissions`, through
 * that unit's surface only. Required inside the e-Factura plugin, so it is on
 * exactly when e-Factura is.
 */
export const cube = {
  manifest: {
    name: "reconciliation",
    parent: "efactura",
    summary: "Manual reconciliation of unknown e-Factura submissions: ANAF's candidates, link, resubmit",
    required: true,
    tables: [],
    requiresAuth: true,
    permissions: [{ name: efacturaPermissions("efactura").reconcile, roles: ["admin"] }],
  },
  create: () => ({ handlers: {} }),
}

export { MAX_LINK_PAGES, MAX_WINDOW_DAYS, OWN_UPLOAD_TYPES, isOwnUpload, listOutcome, listWindow, type ListWindow } from "./domain/listing.ts"
export { createReconciliationService, type Candidate, type Candidates, type ReconciliationService } from "./application/reconciliation.ts"
export type { ReconciliationFailure } from "./application/lookup.ts"
export type { DocumentLoader } from "./application/resubmit.ts"
export type {
  ListCall, ListQuery, LoggedCall, ReconciliationAnaf, ReconciliationDependencies, ReconciliationTransaction, RequestToken,
} from "./application/ports.ts"
