import { positiveInvoiceRequiresDueDate } from "./invoice-positive-total.ts"
import type { Proforma } from "./proforma-models.ts"
import { proformaStatus, type ProformaStatusView } from "./proforma-projection.ts"
import type { RecoverySummary } from "./operation-recovery-types.ts"

/**
 * What a proforma may still become, and whether it may become it now.
 *
 * All of it is derived from the document the server answered: a proforma is
 * converted at most once, and the two ids it carries are the whole record of
 * that. Nothing here asks a question of its own — the screen renders what this
 * says, and the controller refuses anything it has not allowed.
 */
export type ProformaConversionTarget = "invoice" | "draft"

/** The badge and the link a converted proforma shows, so the list and the document never disagree. */
interface ProformaConversionLink {
  readonly href: string
  readonly label: string
  readonly status: ProformaStatusView
}

export type ProformaConversionOutcome =
  /** The proforma was sealed into an invoice: the only thing left is to open it. */
  | ({ readonly kind: "invoice" } & ProformaConversionLink)
  /** It became an editable draft instead, which may or may not have been issued since. */
  | ({ readonly kind: "draft" } & ProformaConversionLink)
  | { readonly kind: "available" }
  /** The document is not loaded yet: not "convertible", which would offer buttons over nothing. */
  | { readonly kind: "unknown" }

export const CONVERSION_CONFIRM = "Emiți factura din această proformă? Liniile și totalurile sunt copiate exact; factura primește data de azi, scadența cu același termen și următorul număr din serie."

export const CONVERSION_DUE_DATE_ISSUE = "Proforma are total pozitiv și nu are scadență. Creează un draft și completează scadența înainte de emiterea facturii."

/**
 * Stated without a link on purpose: the series are configured on a screen this
 * frontend does not have yet, and pointing at a route that answers 404 would be
 * worse than naming the setup.
 */
export const CONVERSION_SERIES_MISSING = "Nu există nicio serie de facturi configurată. Adaugă o serie pentru facturi în aplicația existentă, apoi revino aici."

/** The terms a conversion is judged by, which is all the fiscal rule below needs to know. */
export interface ConversionTerms {
  readonly target: ProformaConversionTarget
  readonly dueDate: string | null
  readonly totalIncludingVat: string
}

/**
 * Why this conversion may not be sent, or `undefined`.
 *
 * The invoice the server would seal takes today's date and this proforma's
 * terms, so a positive total with no due date cannot become one — the draft
 * exists exactly to fill the date in before issuance.
 *
 * Stated here, as a function of the document rather than of the screen, because
 * the controller applies it to every request it is handed: a disabled button is
 * what a user sees, not what makes the rule hold.
 */
export const conversionRefusal = (terms: ConversionTerms): string | undefined =>
  terms.target === "invoice" && positiveInvoiceRequiresDueDate(terms.dueDate, terms.totalIncludingVat)
    ? CONVERSION_DUE_DATE_ISSUE
    : undefined

export const proformaConversionOutcome = (
  proforma: Pick<Proforma, "convertedDraftId" | "convertedInvoiceId">,
): ProformaConversionOutcome => {
  const status = proformaStatus(proforma)
  if (proforma.convertedInvoiceId !== null) {
    return {
      kind: "invoice", status,
      href: `/invoices/${encodeURIComponent(proforma.convertedInvoiceId)}`,
      label: "Deschide factura emisă",
    }
  }
  if (proforma.convertedDraftId !== null) {
    return {
      kind: "draft", status,
      href: `/drafts/${encodeURIComponent(proforma.convertedDraftId)}`,
      label: "Deschide draftul creat anterior",
    }
  }
  return { kind: "available" }
}

/** The same answer for a document that has not arrived yet, which is what a screen holds first. */
export const proformaConversionOutcomeOf = (proforma: Proforma | undefined): ProformaConversionOutcome =>
  proforma === undefined ? { kind: "unknown" } : proformaConversionOutcome(proforma)

/**
 * A chosen series is only trusted while the catalogue still offers it: a series
 * removed between the choice and the click must not be sent, and an empty string
 * is the one value the availability check treats as "nothing chosen".
 */
export const effectiveInvoiceSeries = (options: ReadonlyArray<string>, selected: string): string =>
  options.includes(selected) ? selected : ""

export interface ProformaConversionAvailabilityInput {
  readonly proforma: Proforma | undefined
  /** Already narrowed by `effectiveInvoiceSeries`: the raw selection is the screen's business. */
  readonly selectedSeries: string
  readonly pending: boolean
  /** An unresolved write, or a journal that cannot be read: no conversion may start. */
  readonly blocked: boolean
}

export interface ProformaConversionAvailability {
  readonly outcome: ProformaConversionOutcome
  readonly canIssueInvoice: boolean
  readonly canCreateDraft: boolean
  /** Why issuance alone is refused while the draft route stays open, or `null`. */
  readonly dueDateIssue: string | null
}

export const proformaConversionAvailability = (
  input: ProformaConversionAvailabilityInput,
): ProformaConversionAvailability => {
  const { proforma } = input
  const outcome = proformaConversionOutcomeOf(proforma)
  if (proforma === undefined) {
    return { outcome, canIssueInvoice: false, canCreateDraft: false, dueDateIssue: null }
  }
  // The same rule the controller enforces on the request itself, asked here so
  // the buttons cannot offer what the write would refuse.
  const refusal = conversionRefusal({ target: "invoice", dueDate: proforma.dueDate, totalIncludingVat: proforma.totalIncludingVat })
  const open = outcome.kind === "available" && !input.pending && !input.blocked && input.selectedSeries !== ""
  return {
    outcome,
    canCreateDraft: open,
    canIssueInvoice: open && refusal === undefined,
    dueDateIssue: outcome.kind === "available" ? refusal ?? null : null,
  }
}

/**
 * What the recovery card shows for a conversion whose answer never arrived.
 *
 * The buyer, the line count and the date are the proforma's — that is the
 * document the user recognises — while the series is the one that left in the
 * body, because the resulting invoice takes its number from that series and not
 * from the proforma's.
 */
export const proformaConversionSummary = (proforma: Proforma, invoiceSeries: string): RecoverySummary => ({
  buyerName: proforma.customer.name,
  series: invoiceSeries,
  issueDate: proforma.issueDate,
  lineCount: proforma.lines.length,
})
