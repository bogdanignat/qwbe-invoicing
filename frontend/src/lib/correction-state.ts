import type { CorrectionDocument, CorrectionInput, IssuedInvoice } from "./document-snapshot.ts"
import { money } from "./format.ts"
import { correctionDetailHref } from "./invoice-register-projection.ts"
import type { RecoverySummary } from "./operation-recovery-types.ts"

/**
 * What the storno section of an invoice may offer and how it reads, decided
 * from the corrections the server listed. The storno is integral and the
 * backend allows one per invoice (`invoice_already_corrected`), so an invoice
 * that already lists one offers no form.
 */
export interface CorrectionRef {
  readonly id: string
  readonly series: string
  readonly number: number
  readonly issueDate: string
}

export interface CorrectionRow {
  readonly id: string
  readonly href: string
  readonly title: string
  readonly caption: string
  readonly reason: string
}

export interface CorrectionsView {
  readonly rows: ReadonlyArray<CorrectionRow>
  readonly canIssue: boolean
  /** The storno that reverses this invoice, when there is one. */
  readonly correctedBy: CorrectionRef | undefined
}

export const correctionsView = (corrections: ReadonlyArray<CorrectionDocument>): CorrectionsView => {
  const first = corrections[0]
  return {
    rows: corrections.map((correction) => ({
      id: correction.id,
      href: correctionDetailHref(correction.id),
      title: `Storno ${correction.series} ${String(correction.number)}`,
      caption: `${correction.issueDate} · ${money(correction.totalIncludingVat, correction.currency)}`,
      reason: correction.reason,
    })),
    canIssue: first === undefined,
    correctedBy: first === undefined
      ? undefined
      : { id: first.id, series: first.series, number: first.number, issueDate: first.issueDate },
  }
}

const formText = (form: FormData, name: string): string => {
  const value = form.get(name)
  return typeof value === "string" ? value.trim() : ""
}

/** The request body from the submitted form; the backend validates both fields and the date range. */
export const correctionInputFrom = (form: FormData): CorrectionInput => ({
  reason: formText(form, "reason"),
  issueDate: formText(form, "issueDate"),
})

/** What the recovery card shows for a storno: the invoice's buyer, series and lines, and the storno's date. */
export const correctionSummary = (invoice: IssuedInvoice, body: CorrectionInput): RecoverySummary => ({
  buyerName: invoice.customer.name,
  series: invoice.series,
  issueDate: body.issueDate,
  lineCount: invoice.lines.length,
})

/** The backend's limit on the reason (`cube/invoicing/corrections/domain/corrections.ts:25`). */
export const CORRECTION_REASON_MAX_LENGTH = 300

export const CORRECTION_CONFIRM = "Emiți un document storno integral? Documentul va fi fiscal și imuabil."
export const CORRECTION_ALREADY_ISSUED_NOTE = "Storno-ul integral a fost deja emis; nu poate fi duplicat."
