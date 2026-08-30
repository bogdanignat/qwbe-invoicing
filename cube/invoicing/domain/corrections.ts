import { ValidationFailure } from "../contracts/failures.ts"
export interface CreateCorrectionInput { readonly originalInvoiceId: string; readonly reason: string; readonly issueDate?: string }
export interface CorrectionDocument {
  readonly id: string; readonly organizationId: string; readonly originalInvoiceId: string
  readonly fiscalYear: number; readonly series: string; readonly number: number
  readonly issueDate: string; readonly issuedAt: string; readonly reason: string
  readonly currency: string
  readonly issuer: { readonly legalName: string; readonly taxIdentifier: string; readonly address: { readonly countryCode: string; readonly city: string; readonly street: string; readonly county?: string; readonly postalCode?: string } }
  readonly customer: { readonly legalName: string; readonly taxIdentifier: string; readonly address: { readonly countryCode: string; readonly city: string; readonly street: string; readonly county?: string; readonly postalCode?: string } }
  readonly lines: ReadonlyArray<{ readonly id: string; readonly description: string; readonly quantity: string; readonly unitPrice: string; readonly taxCode: string; readonly taxCategory: string; readonly taxRate: string; readonly totalExcludingTax: string; readonly taxAmount: string; readonly totalIncludingTax: string }>
  readonly taxBreakdown: ReadonlyArray<{ readonly taxCode: string; readonly category: string; readonly rate: string; readonly taxableAmount: string; readonly taxAmount: string }>
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
