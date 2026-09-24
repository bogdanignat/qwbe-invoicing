import type { AuthoringDocumentInput, DraftInvoice, Issuer, VatCatalogue, VatRate } from "./draft-models.ts"
import type {
  AuthoringReadiness, AuthoringTaxReadiness, EditableInvoiceLine, InvoiceAuthoringForm,
} from "./invoice-authoring-model.ts"
import { authoringDocumentPayload } from "./invoice-authoring-payload.ts"
import { authoringReadiness, authoringTaxReadiness } from "./invoice-authoring-readiness.ts"
import { positiveInvoiceRequiresDueDate } from "./invoice-positive-total.ts"
import { knownResultNotice, type KnownWrite, type RecoveryNoticeModel } from "./operation-recovery-view.ts"
import { vatRatesForIssuer } from "./vat-defaults.ts"

/**
 * Everything the authoring screen can work out from the form, the lines and the
 * server's draft, in one place: what is ready, what the document would be if it
 * were sent now, which VAT rates apply, and whether the tax snapshot the draft
 * carries has gone stale.
 *
 * It is a plain function so the rules can be read and tested without a screen.
 */
export interface AuthoringDerivedInput {
  readonly form: InvoiceAuthoringForm
  readonly lines: ReadonlyArray<EditableInvoiceLine>
  readonly draft: DraftInvoice | undefined
  readonly workflowPending: boolean
  readonly issuer: Issuer
  readonly vatCatalogue: VatCatalogue
  readonly staleLineIds: (draft: DraftInvoice) => ReadonlyArray<string>
}

export interface AuthoringDerived {
  readonly readiness: AuthoringReadiness
  readonly payload: AuthoringDocumentInput
  readonly vatRates: ReadonlyArray<VatRate>
  readonly staleTax: boolean
  readonly taxReadiness: AuthoringTaxReadiness
  readonly dueDateRequired: boolean
}

export const authoringDerived = (input: AuthoringDerivedInput): AuthoringDerived => {
  const readiness = authoringReadiness(input.form, input.lines, input.draft, input.workflowPending)
  const staleTax = input.draft !== undefined && input.staleLineIds(input.draft).length > 0
  return {
    readiness,
    payload: authoringDocumentPayload(input.form, input.lines),
    vatRates: vatRatesForIssuer(input.vatCatalogue, input.issuer, input.form.issueDate),
    staleTax,
    taxReadiness: authoringTaxReadiness(readiness, staleTax),
    // A draft may be saved without a due date; a positive-total invoice may not.
    dueDateRequired: positiveInvoiceRequiresDueDate(
      input.form.dueDate,
      readiness.synchronized ? input.draft?.totalIncludingVat : undefined,
      input.lines,
    ),
  }
}

/**
 * The two sources of an unresolved write on one authoring screen — the journal
 * (an intent written down before a request left, plus an explicit replay) and
 * the issuance controller's own confirmed-but-unfollowed result — answered as
 * one state, because the screen has one save button and one issue button.
 *
 * Precedence goes to the journal: an intent with an unknown outcome still needs
 * its replay, while a known result only needs to be read and acknowledged. Both
 * keep every new write closed: the form is still the same document, so a normal
 * save or issue would author a second one under a fresh key.
 */
export type RecoveryAcknowledgement = "journal" | "issuance" | "none"

export interface AuthoringRecoveryInput {
  /** What the journal and the explicit replay say, already rendered as a notice. */
  readonly journalNotice: RecoveryNoticeModel | undefined
  /** The journal also blocks with no notice at all: before hydration nothing may leave. */
  readonly journalBlocked: boolean
  /** The issuance the server confirmed and the screen could not follow. */
  readonly issuanceKnownResult: KnownWrite | undefined
}

export interface AuthoringRecoveryDerived {
  readonly notice: RecoveryNoticeModel | undefined
  /** Save, issue and every other new write are held back while this is true. */
  readonly blocked: boolean
  /** Which source the dismiss button must acknowledge, so the reset lands on the branch that is showing. */
  readonly acknowledges: RecoveryAcknowledgement
  /** The issuance error is the very thing the known-result notice explains; two messages for one event help nobody. */
  readonly suppressIssuanceError: boolean
}

export const authoringRecoveryDerived = (input: AuthoringRecoveryInput): AuthoringRecoveryDerived => {
  const issuanceNotice = knownResultNotice(input.issuanceKnownResult)
  const acknowledges: RecoveryAcknowledgement = input.journalNotice !== undefined
    ? "journal"
    : issuanceNotice === undefined ? "none" : "issuance"
  return {
    notice: input.journalNotice ?? issuanceNotice,
    blocked: input.journalBlocked || issuanceNotice !== undefined,
    acknowledges,
    suppressIssuanceError: acknowledges === "issuance",
  }
}

/**
 * Whether the issue button may send anything at all. A confirmed issuance the
 * screen could not follow closes it for good: the invoice exists and is named,
 * and issuing again from here would seal a second one under a fresh key.
 */
export interface IssuanceGateInput {
  /** What the rest of the screen allows: tax readiness, the due date, the journal, an unconfirmed save. */
  readonly requested: boolean
  readonly workflowPending: boolean
  readonly issuePending: boolean
  readonly knownResult: KnownWrite | undefined
}

export const issuanceAllowed = (input: IssuanceGateInput): boolean =>
  input.requested && !input.workflowPending && !input.issuePending && input.knownResult === undefined
