import { decodePage, integer, nullableText, object, text, type Decoder } from "./model-decoder.ts"

/**
 * One register, two document kinds.
 *
 * The backend returns invoices and corrections in a single cursor-ordered feed,
 * and the two are told apart only by `kind`. Each kind fixes the other fields:
 * an invoice may have a due date, a correction never has one and always names
 * the invoice it reverses. Both carry an e-Factura status. Decoding asserts
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

const eFacturaStatuses = ["not_sent", "queued", "processing", "accepted", "rejected", "refused", "unknown"] as const

/** The document's view of its current e-Factura submission; `processing` covers validation, upload and ANAF's verdict. */
export type EFacturaStatus = (typeof eFacturaStatuses)[number]

/** `null` is a document of an installation that runs no e-Factura plugin; any other value is the closed enum. */
export const decodeEFacturaStatus = (input: unknown): EFacturaStatus | null => {
  if (input === null) return null
  const status = eFacturaStatuses.find((known) => known === input)
  if (status === undefined) throw new Error("invalid eFacturaStatus")
  return status
}

export interface InvoiceRegisterInvoiceRow extends InvoiceRegisterCommon {
  readonly kind: "invoice"
  readonly dueDate: string | null
  readonly eFacturaStatus: EFacturaStatus | null
  readonly originalReference?: never
}

export interface InvoiceRegisterCorrectionRow extends InvoiceRegisterCommon {
  readonly kind: "correction"
  readonly dueDate: null
  readonly eFacturaStatus: EFacturaStatus | null
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
    const original = object(value.originalReference)
    return {
      kind: "correction",
      ...common,
      dueDate: null,
      eFacturaStatus: decodeEFacturaStatus(value.eFacturaStatus),
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
