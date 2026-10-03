import type { DraftInvoice } from "./draft-models.ts"
import type { IssuedInvoice } from "./document-snapshot.ts"
import type { ProformaIdentity } from "./proforma-replay-client.ts"
import type { RecoveryRequest } from "./operation-recovery-types.ts"

/**
 * The stored request, turned back into the one call that can settle it.
 *
 * Every write the journal may hold is listed once, so the mapping from "what
 * was written down" to "what is sent" is a single exhaustive statement rather
 * than a chain of conditions spread through the replay controller. A request
 * kind added without a branch here does not compile.
 */
export interface ReplayClient {
  readonly replayDraftCreation: (csrfToken: string, body: unknown, idempotencyKey: string) => Promise<DraftInvoice>
  readonly issueDraft: (csrfToken: string, id: string, idempotencyKey: string) => Promise<IssuedInvoice>
  readonly replayInvoiceIssuance: (csrfToken: string, body: unknown, idempotencyKey: string) => Promise<IssuedInvoice>
  readonly replayProformaIssuance: (csrfToken: string, body: unknown, idempotencyKey: string) => Promise<ProformaIdentity>
  readonly replayInvoiceFromProforma: (csrfToken: string, proformaId: string, body: unknown, idempotencyKey: string) => Promise<IssuedInvoice>
  readonly replayDraftFromProforma: (csrfToken: string, proformaId: string, body: unknown, idempotencyKey: string) => Promise<DraftInvoice>
}

/**
 * What the server handed back, named by the document the screen must now
 * follow. A conversion is not its own family: it produces an invoice or a
 * draft, and those are followed exactly like the ones authored directly.
 *
 * `sourceProformaId` is the one thing a conversion carries beyond the document:
 * the proforma it started from is no longer convertible, and the screen that
 * holds it has to be told so — the answer itself does not always say (an issued
 * invoice carries no trace of its proforma).
 */
export type ReplayResult =
  | { readonly kind: "draft"; readonly draft: DraftInvoice; readonly sourceProformaId?: string }
  | { readonly kind: "issued"; readonly invoice: IssuedInvoice; readonly sourceProformaId?: string }
  | { readonly kind: "proforma"; readonly proforma: ProformaIdentity }

export const sendStoredRequest = async (
  client: ReplayClient,
  csrfToken: string,
  request: RecoveryRequest,
  idempotencyKey: string,
): Promise<ReplayResult> => {
  switch (request.kind) {
    case "create-draft":
      return { kind: "draft", draft: await client.replayDraftCreation(csrfToken, request.body, idempotencyKey) }
    case "issue-draft":
      return { kind: "issued", invoice: await client.issueDraft(csrfToken, request.draftId, idempotencyKey) }
    case "issue-invoice":
      return { kind: "issued", invoice: await client.replayInvoiceIssuance(csrfToken, request.body, idempotencyKey) }
    case "create-proforma":
      return { kind: "proforma", proforma: await client.replayProformaIssuance(csrfToken, request.body, idempotencyKey) }
    case "convert-proforma-invoice":
      return {
        kind: "issued",
        invoice: await client.replayInvoiceFromProforma(csrfToken, request.proformaId, request.body, idempotencyKey),
        sourceProformaId: request.proformaId,
      }
    case "convert-proforma-draft":
      return {
        kind: "draft",
        draft: await client.replayDraftFromProforma(csrfToken, request.proformaId, request.body, idempotencyKey),
        sourceProformaId: request.proformaId,
      }
  }
}
