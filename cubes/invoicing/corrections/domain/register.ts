import type { EFacturaStatus } from "../../domain/invoice.ts"

export type InvoiceRegisterKind = "invoice" | "correction"

interface RegisterRow {
  readonly id: string
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly customer: { readonly name: string }
  readonly currency: string
  readonly totalIncludingVat: string
}

export interface InvoiceRegisterInvoiceRow extends RegisterRow {
  readonly kind: "invoice"
  readonly dueDate: string | null
  readonly eFacturaStatus: EFacturaStatus
}

export interface InvoiceRegisterCorrectionRow extends RegisterRow {
  readonly kind: "correction"
  readonly dueDate: null
  readonly eFacturaStatus: null
  readonly originalReference: { readonly id: string; readonly series: string; readonly number: number }
}

export type InvoiceRegisterRow = InvoiceRegisterInvoiceRow | InvoiceRegisterCorrectionRow
export interface InvoiceRegisterCursor {
  readonly issueDate: string
  readonly number: number
  readonly id: string
  readonly kind: InvoiceRegisterKind
}
