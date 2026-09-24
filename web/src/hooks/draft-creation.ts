import { runUiEffect } from "../lib/api.ts"
import { createDraftPayload, type InvoiceAuthoringForm } from "../lib/invoice-authoring-state.ts"
import { invoicingClient } from "../lib/invoicing-client.ts"
import type { DraftInvoice } from "../lib/models.ts"
import type { OperationIdempotency } from "./operation-idempotency.ts"

/**
 * The first save of a new document: one key per document intent, derived from the
 * payload, so retrying the same save reuses it and the server replays the draft it
 * already made. The key is deliberately never dropped on failure — an answer that
 * did not arrive, or arrived unreadable, may still have committed a draft, and a
 * fresh key would author a second one. Editing the form changes the payload, which
 * is a different intent and therefore a new key. Only a draft that exists retires
 * its key.
 */
export const createServerDraft = async (
  form: InvoiceAuthoringForm,
  idempotency: OperationIdempotency,
): Promise<DraftInvoice> => {
  const payload = createDraftPayload(form)
  const draft = await runUiEffect(invoicingClient.createDraft(payload, idempotency.current("create-draft", JSON.stringify(payload))))
  idempotency.complete("create-draft")
  return draft
}
