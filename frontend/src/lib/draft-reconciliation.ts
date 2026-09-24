import { ApiFailure } from "./api-errors.ts"
import type { DraftInvoice, DraftLineInput } from "./draft-models.ts"
import type { InvoiceAuthoringForm } from "./invoice-authoring-model.ts"
import { headerMatchesDraft } from "./invoice-authoring-readiness.ts"
import { lineInputMatches } from "./invoice-authoring-options.ts"

/**
 * A failure whose request may still have committed: the answer never arrived,
 * or a gateway answered for a request whose outcome is unknowable from here.
 * Only the server's own idempotency store (issuance) or a reconciliation read
 * (drafts) can say what happened, so nothing here retries blindly.
 */
export const isLostResponse = (error: unknown): boolean =>
  error instanceof ApiFailure
  && (error.status === undefined || error.status === 408 || error.status >= 500)

export type Reconciliation =
  | { readonly kind: "persisted"; readonly draft: DraftInvoice }
  | { readonly kind: "missing" }
  | { readonly kind: "diverged"; readonly message: string }

const CONCURRENT_CHANGE = "Draftul s-a schimbat în altă sesiune. Reîncarcă pagina înainte de a continua."

export type HeaderReconciliation =
  | { readonly kind: "persisted"; readonly draft: DraftInvoice }
  | { readonly kind: "missing" }

/** Whether a header update that lost its answer actually landed. */
export const reconcileHeaderUpdate = (
  form: InvoiceAuthoringForm,
  fresh: DraftInvoice,
): HeaderReconciliation =>
  headerMatchesDraft(form, fresh)
    ? { kind: "persisted", draft: fresh }
    : { kind: "missing" }

/**
 * Whether a line create that lost its answer actually landed.
 *
 * The lines the draft already had are named by their server ids, so "new since
 * the last confirmed answer" is knowable: exactly one new line matching the
 * intent means it landed; none means it did not; anything else — two matches,
 * or a foreign change — cannot be attributed and stops the save.
 */
export const reconcileLineCreate = (
  intent: DraftLineInput,
  previousLineIds: ReadonlySet<string>,
  fresh: DraftInvoice,
): Reconciliation => {
  const newLines = fresh.lines.filter((line) => !previousLineIds.has(line.id))
  const matches = newLines.filter((line) => lineInputMatches(intent, line))
  if (matches.length === 1) return { kind: "persisted", draft: fresh }
  if (matches.length === 0 && newLines.length === 0) return { kind: "missing" }
  if (matches.length === 0) return { kind: "diverged", message: CONCURRENT_CHANGE }
  return {
    kind: "diverged",
    message: "Rezultatul salvării liniei nu poate fi confirmat. Întoarce-te la lista drafturilor, reîncarcă și reconciliază liniile înainte de a continua.",
  }
}

/** Whether a line update that lost its answer actually landed. */
export const reconcileLineUpdate = (
  lineId: string,
  intent: DraftLineInput,
  fresh: DraftInvoice,
): Reconciliation => {
  const line = fresh.lines.find((item) => item.id === lineId)
  if (line === undefined) return { kind: "diverged", message: CONCURRENT_CHANGE }
  return lineInputMatches(intent, line)
    ? { kind: "persisted", draft: fresh }
    : { kind: "missing" }
}
