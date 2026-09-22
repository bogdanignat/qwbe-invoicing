import { integer, nullableText, object, text, type Decoder } from "./model-decoder.ts"
import { decodePage } from "./page-decoders.ts"
import { money } from "./format.ts"

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

type EFacturaStatus = "not_sent" | "pending" | "sent" | "accepted" | "rejected"

const decodeEFacturaStatus = (input: unknown): EFacturaStatus => {
  if (input === "not_sent" || input === "pending" || input === "sent" || input === "accepted" || input === "rejected") return input
  throw new Error("invalid eFacturaStatus")
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
    id: text(value.id, "id"), series: text(value.series, "series"),
    number: integer(value.number, "number"), issueDate: text(value.issueDate, "issueDate"),
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
      kind: "invoice", ...common, dueDate: nullableText(value.dueDate, "dueDate"),
      eFacturaStatus: decodeEFacturaStatus(value.eFacturaStatus),
    }
  }
  if (value.kind === "correction") {
    const common = decodeCommon(value)
    if (value.dueDate !== null) throw new Error("invalid dueDate")
    if (value.eFacturaStatus !== null) throw new Error("invalid eFacturaStatus")
    const original = object(value.originalReference)
    return {
      kind: "correction", ...common, dueDate: null, eFacturaStatus: null,
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

export interface InvoiceRegisterPresentationRow {
  readonly key: string
  readonly number: string
  readonly kindLabel: "Storno" | null
  readonly documentHref: string | null
  readonly customerName: string
  readonly issueDate: string
  readonly dueDate: string
  readonly total: string
  readonly status: string
  readonly originalInvoice: { readonly label: string; readonly href: string } | null
}

export const projectInvoiceRegisterRow = (row: InvoiceRegisterRow): InvoiceRegisterPresentationRow => ({
  key: `${row.kind}:${row.id}`,
  number: `${row.series} ${String(row.number)}`,
  kindLabel: row.kind === "correction" ? "Storno" : null,
  documentHref: row.kind === "invoice" ? `/invoices/${encodeURIComponent(row.id)}` : null,
  customerName: row.customer.name,
  issueDate: row.issueDate,
  dueDate: row.dueDate ?? "—",
  total: money(row.totalIncludingVat, row.currency),
  status: row.eFacturaStatus ?? "—",
  originalInvoice: row.kind === "correction" ? {
    label: `Factura inițială ${row.originalReference.series}/${String(row.originalReference.number)}`,
    href: `/invoices/${encodeURIComponent(row.originalReference.id)}`,
  } : null,
})
