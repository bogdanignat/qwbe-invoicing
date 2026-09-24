import { decodePage, integer, nullableText, object, text, type Decoder } from "./model-decoder.ts"

/**
 * One register, two document kinds.
 *
 * The backend returns invoices and corrections in a single cursor-ordered feed,
 * and the two are told apart only by `kind`. Each kind fixes the other fields:
 * an invoice carries an e-Factura status and may have a due date, a correction
 * carries neither and always names the invoice it reverses. Decoding asserts
 * that exclusivity instead of accepting a row that claims both, so a view can
 * branch on `kind` alone.
 */
interface InvoiceRegisterCustomer {
  readonly name: string
}

interface InvoiceRegisterCommon {
  readonly id: string
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly customer: InvoiceRegisterCustomer
  readonly currency: string
  readonly totalIncludingVat: string
}

export type EFacturaStatus = "not_sent" | "pending" | "sent" | "accepted" | "rejected"

const eFacturaStatuses: ReadonlyArray<string> = ["not_sent", "pending", "sent", "accepted", "rejected"]

export const decodeEFacturaStatus = (input: unknown): EFacturaStatus => {
  if (typeof input !== "string" || !eFacturaStatuses.includes(input)) throw new Error("invalid eFacturaStatus")
  return input as EFacturaStatus
}

export interface InvoiceRegisterInvoiceRow extends InvoiceRegisterCommon {
  readonly kind: "invoice"
  readonly dueDate: string | null
  readonly eFacturaStatus: EFacturaStatus
  readonly originalReference?: never
}

export interface InvoiceRegisterCorrectionRow extends InvoiceRegisterCommon {
  readonly kind: "correction"
  readonly dueDate: null
  readonly eFacturaStatus: null
  readonly originalReference: {
    readonly id: string
    readonly series: string
    readonly number: number
  }
}

export type InvoiceRegisterRow = InvoiceRegisterInvoiceRow | InvoiceRegisterCorrectionRow

const decodeCommon = (value: Readonly<Record<string, unknown>>): InvoiceRegisterCommon => {
  const customer = object(value.customer)
  return {
    id: text(value.id, "id"),
    series: text(value.series, "series"),
    number: integer(value.number, "number"),
    issueDate: text(value.issueDate, "issueDate"),
    customer: { name: text(customer.name, "customer.name") },
    currency: text(value.currency, "currency"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
  }
}

export const decodeInvoiceRegisterRow: Decoder<InvoiceRegisterRow> = (input) => {
  const value = object(input)
  if (value.kind === "invoice") {
    const common = decodeCommon(value)
    if (value.originalReference !== undefined) throw new Error("invalid originalReference")
    return {
      kind: "invoice",
      ...common,
      dueDate: nullableText(value.dueDate, "dueDate"),
      eFacturaStatus: decodeEFacturaStatus(value.eFacturaStatus),
    }
  }
  if (value.kind === "correction") {
    const common = decodeCommon(value)
    if (value.dueDate !== null) throw new Error("invalid dueDate")
    if (value.eFacturaStatus !== null) throw new Error("invalid eFacturaStatus")
    const original = object(value.originalReference)
    return {
      kind: "correction",
      ...common,
      dueDate: null,
      eFacturaStatus: null,
      originalReference: {
        id: text(original.id, "originalReference.id"),
        series: text(original.series, "originalReference.series"),
        number: integer(original.number, "originalReference.number"),
      },
    }
  }
  throw new Error("invalid kind")
}

export const decodeInvoiceRegisterPage = decodePage<InvoiceRegisterRow>(decodeInvoiceRegisterRow)
