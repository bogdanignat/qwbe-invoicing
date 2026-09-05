import { ValidationFailure } from "../contracts/failures.ts"
import type { BuyerSnapshot, DocumentSource, DraftLine, PartySnapshot, TaxBreakdown } from "./invoice.ts"
export interface CreateCorrectionInput {
  readonly originalInvoiceId: string
  readonly reason: string
  readonly issueDate?: string
  readonly source?: DocumentSource
}
export interface CorrectionDocument {
  readonly id: string; readonly organizationId: string; readonly originalInvoiceId: string
  readonly source?: DocumentSource
  readonly fiscalYear: number; readonly series: string; readonly number: number
  readonly issueDate: string; readonly issuedAt: string; readonly reason: string
  readonly currency: string
  readonly issuer: PartySnapshot
  readonly customer: BuyerSnapshot
  readonly lines: ReadonlyArray<DraftLine>
  readonly taxBreakdown: ReadonlyArray<TaxBreakdown>
  readonly totalExcludingTax: string; readonly taxTotal: string; readonly totalIncludingTax: string
}
export const validateCreateCorrectionInput = (input: CreateCorrectionInput): void => {
  const issues: Array<string> = []
  if (input.originalInvoiceId.trim().length === 0) issues.push("originalInvoiceId is required")
  if (input.reason.trim().length === 0) issues.push("reason is required")
  if (input.reason.trim().length > 500) issues.push("reason must be at most 500 characters")
  if (input.issueDate !== undefined) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.issueDate)
    if (m === null) issues.push("issueDate must be YYYY-MM-DD")
    else {
      const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]); const date = new Date(Date.UTC(y, mo - 1, d))
      if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) issues.push("issueDate must be a valid calendar date")
    }
  }
  if (issues.length > 0) throw new ValidationFailure({ issues })
}
export const negateMoney = (value: string): string => value.startsWith("-") ? value.slice(1) : `-${value}`
