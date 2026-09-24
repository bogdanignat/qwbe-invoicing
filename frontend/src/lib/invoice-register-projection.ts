import { money } from "./format.ts"
import type { EFacturaStatus, InvoiceRegisterRow } from "./invoice-register.ts"

/**
 * The register row as a table renders it: every field already a string.
 *
 * Keeping the shaping here rather than in the table means the labels, the
 * dashes for absent fields and the detail links are all testable without
 * rendering anything, and the component is left with markup only.
 */
export interface InvoiceRegisterPresentationRow {
  readonly key: string
  readonly number: string
  readonly kindLabel: "Storno" | null
  readonly documentHref: string
  readonly customerName: string
  readonly issueDate: string
  readonly dueDate: string
  readonly total: string
  readonly status: string
  readonly originalInvoice: { readonly label: string; readonly href: string } | null
}

const statusLabels: Readonly<Record<EFacturaStatus, string>> = {
  not_sent: "Netrimisă",
  pending: "În curs",
  sent: "Trimisă",
  accepted: "Acceptată",
  rejected: "Respinsă",
}

/**
 * One label per status, for the register row and the document head alike.
 *
 * The same invoice is named in both places; localizing it here and in the
 * detail projection separately is how `Netrimisă` in the list and `not_sent`
 * on the document came to be two answers to the same question.
 */
export const eFacturaStatusLabel = (status: EFacturaStatus): string => statusLabels[status]

export const invoiceDetailHref = (id: string): string => `/invoices/${encodeURIComponent(id)}`
export const correctionDetailHref = (id: string): string => `/corrections/${encodeURIComponent(id)}`

export const projectInvoiceRegisterRow = (row: InvoiceRegisterRow): InvoiceRegisterPresentationRow => ({
  key: `${row.kind}:${row.id}`,
  number: `${row.series} ${String(row.number)}`,
  kindLabel: row.kind === "correction" ? "Storno" : null,
  documentHref: row.kind === "invoice" ? invoiceDetailHref(row.id) : correctionDetailHref(row.id),
  customerName: row.customer.name,
  issueDate: row.issueDate,
  dueDate: row.dueDate ?? "—",
  total: money(row.totalIncludingVat, row.currency),
  status: row.eFacturaStatus === null ? "—" : statusLabels[row.eFacturaStatus],
  originalInvoice: row.kind === "correction"
    ? {
      label: `Factura inițială ${row.originalReference.series} ${String(row.originalReference.number)}`,
      href: invoiceDetailHref(row.originalReference.id),
    }
    : null,
})

export type RegisterKindFilter = "all" | "invoice" | "correction"

export interface RegisterFilter {
  readonly kind: RegisterKindFilter
  readonly search: string
}

export const emptyRegisterFilter: RegisterFilter = { kind: "all", search: "" }

/**
 * Filtering is over the pages already loaded, not over the register.
 *
 * `GET /api/invoice-register` takes only `limit` and `cursor`; it has no status,
 * customer or date parameter, so no filter here can be pushed to the server.
 * Narrowing what is on screen is therefore exactly that — a narrowing of the
 * rows fetched so far — and "Încarcă mai multe" keeps following the cursor
 * independently of it. A filter that silently hid later pages would read as a
 * complete answer to a question it never asked the backend.
 */
export const filterInvoiceRegisterRows = (
  rows: ReadonlyArray<InvoiceRegisterRow>,
  filter: RegisterFilter,
): ReadonlyArray<InvoiceRegisterRow> => {
  const search = filter.search.trim().toLocaleLowerCase("ro-RO")
  return rows.filter((row) => {
    if (filter.kind !== "all" && row.kind !== filter.kind) return false
    if (search === "") return true
    const haystack = `${row.series} ${String(row.number)} ${row.customer.name}`.toLocaleLowerCase("ro-RO")
    return haystack.includes(search)
  })
}
