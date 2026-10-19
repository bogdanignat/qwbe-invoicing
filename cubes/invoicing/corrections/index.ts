const identity = "corrections"

export const cube = {
  manifest: {
    name: identity,
    parent: "invoicing",
    summary: "Full correction documents (storno) that reverse an issued invoice",
    required: true,
    tables: [],
    requiresAuth: true,
    permissions: [],
  },
  create: () => ({ handlers: {} }),
}

export { createCorrectionOperations } from "./application/corrections.ts"
export type { CorrectionOperations } from "./application/corrections.ts"
export { createInvoiceRegisterOperations } from "./application/register.ts"
export type { InvoiceRegisterOperations } from "./application/register.ts"
export { createRevenueReportOperations } from "./application/reports.ts"
export type { RevenueReportOperations } from "./application/reports.ts"
export type { CorrectionsTransaction } from "./application/ports.ts"
export { negateDecimal, validateCreateCorrectionInput } from "./domain/corrections.ts"
export type { CorrectionDocument, CreateCorrectionInput } from "./domain/corrections.ts"
export type { InvoiceRegisterCursor, InvoiceRegisterKind, InvoiceRegisterRow } from "./domain/register.ts"
export { continuousMonths, reportPeriodIssues } from "./domain/reports.ts"
export type { ReportPeriod, RevenueFigures, RevenueReport } from "./domain/reports.ts"
