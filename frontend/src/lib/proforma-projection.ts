import { documentBodyView, type DocumentSnapshotView } from "./document-projection.ts"
import { money, orDash } from "./format.ts"
import type { Proforma } from "./proforma-models.ts"

/**
 * What a proforma's conversion state reads as, in the registry and on its own
 * screen.
 *
 * The two conversion ids are the only source: a proforma the server has not
 * converted carries neither, a conversion into a sealed invoice carries the
 * invoice id, a conversion into an editable draft carries the draft id. The
 * invoice is checked first because it is the stronger fact — a draft created
 * from a proforma can later be issued, and the server then records both — so a
 * proforma whose draft has become an invoice must not keep reading as "draft
 * created".
 *
 * The tone is a presentation token the table and the detail share, so one
 * proforma is never described as converted in the list and open in the detail.
 */
export interface ProformaStatusView {
  readonly label: "Nefacturată" | "Draft factură creat" | "Facturată"
  readonly tone: "muted" | "info" | "positive"
}

export const proformaStatus = (
  proforma: Pick<Proforma, "convertedDraftId" | "convertedInvoiceId">,
): ProformaStatusView => {
  if (proforma.convertedInvoiceId !== null) return { label: "Facturată", tone: "positive" }
  if (proforma.convertedDraftId !== null) return { label: "Draft factură creat", tone: "info" }
  return { label: "Nefacturată", tone: "muted" }
}

export const proformaDetailHref = (id: string): string => `/proformas/${encodeURIComponent(id)}`

/**
 * A registry row with every cell already a string.
 *
 * The shaping is here rather than in the table for the same reason the invoice
 * register's is: the dashes for an absent due date, the money formatting and the
 * detail link are all testable without rendering anything.
 */
export interface ProformaRegisterRow {
  readonly key: string
  readonly number: string
  readonly documentHref: string
  readonly customerName: string
  readonly issueDate: string
  readonly dueDate: string
  readonly total: string
  readonly status: ProformaStatusView
}

export const projectProformaRegisterRow = (proforma: Proforma): ProformaRegisterRow => ({
  key: proforma.id,
  number: `${proforma.series} ${String(proforma.number)}`,
  documentHref: proformaDetailHref(proforma.id),
  customerName: proforma.customer.name,
  issueDate: proforma.issueDate,
  dueDate: orDash(proforma.dueDate),
  total: money(proforma.totalIncludingVat, proforma.currency),
  status: proformaStatus(proforma),
})

export const projectProformaRegister = (
  proformas: ReadonlyArray<Proforma>,
): ReadonlyArray<ProformaRegisterRow> => proformas.map(projectProformaRegisterRow)

/**
 * The document itself, through the same view the fiscal screens render.
 *
 * The body is the shared one — the parties, the lines, the VAT breakdown and the
 * totals are the copies the server sealed — and only the head differs: where an
 * invoice states its e-Factura status, a proforma states its conversion status,
 * because that is the fact about it a reader needs and it has no fiscal
 * transmission to report. `originalInvoice` stays `null`: that link belongs to a
 * correction, and a proforma's own links (the invoice or draft it became) live
 * in the conversion section, not in the document head.
 */
export const projectProforma = (proforma: Proforma): DocumentSnapshotView => ({
  ...documentBodyView(proforma),
  facts: [
    { label: "Emisă", value: proforma.issueDate },
    { label: "Scadență", value: orDash(proforma.dueDate) },
    { label: "Monedă", value: proforma.currency },
    { label: "Status", value: proformaStatus(proforma).label },
  ],
  notes: proforma.notes,
  originalInvoice: null,
})
