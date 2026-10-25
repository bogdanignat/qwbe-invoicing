import { orDash } from "./format.ts"
import { formatAmount, money } from "./money.ts"
import { eFacturaStatusLabel, invoiceDetailHref } from "./invoice-register-projection.ts"
import { vatTreatmentLabel } from "./vat-snapshots.ts"
import { identifiersLabel } from "./item-identifiers.ts"
import { customerView, issuerView, type PartyView } from "./document-party-projection.ts"
import type {
  CorrectionDocument, DocumentBody, DocumentLine, IssuedInvoice, VatBreakdownEntry,
} from "./document-snapshot.ts"

export interface LabelledValue {
  readonly label: string
  readonly value: string
}

export interface DocumentLineView {
  readonly key: string
  readonly description: string
  /** The article code and EAN the line was issued with; empty when it has neither. */
  readonly identifiers: string
  readonly quantity: string
  readonly unitPrice: string
  readonly vat: string
  readonly totalExcludingVat: string
  readonly vatAmount: string
  readonly totalIncludingVat: string
}

export interface VatRowView {
  readonly key: string
  readonly rate: string
  readonly base: string
  readonly amount: string
  readonly note: string
}

export interface DocumentSnapshotView {
  readonly heading: string
  readonly facts: ReadonlyArray<LabelledValue>
  readonly parties: ReadonlyArray<PartyView>
  readonly lines: ReadonlyArray<DocumentLineView>
  readonly vatRows: ReadonlyArray<VatRowView>
  readonly totals: ReadonlyArray<LabelledValue>
  readonly notes: string | null
  readonly originalInvoice: { readonly label: string; readonly href: string } | null
}

const lineView = (line: DocumentLine, currency: string): DocumentLineView => ({
  key: line.id,
  description: line.description,
  identifiers: identifiersLabel(line),
  quantity: `${formatAmount(line.quantity)} ${line.unitOfMeasure.name}`,
  unitPrice: money(line.unitPrice, currency),
  vat: vatTreatmentLabel({ vatCategoryCode: line.vatCategoryCode, rate: line.vatRate }),
  totalExcludingVat: money(line.totalExcludingVat, currency),
  vatAmount: money(line.vatAmount, currency),
  totalIncludingVat: money(line.totalIncludingVat, currency),
})

// The key pairs category with rate, as legacy does: `code` alone is not
// guaranteed unique across a breakdown that can carry the same code twice.
const vatRowView = (entry: VatBreakdownEntry, currency: string): VatRowView => ({
  key: `${entry.vatCategoryCode}-${entry.rate}`,
  rate: vatTreatmentLabel({ vatCategoryCode: entry.vatCategoryCode, rate: entry.rate }),
  base: money(entry.vatBaseAmount, currency),
  amount: money(entry.vatAmount, currency),
  note: orDash(entry.vatExemptionReason),
})

const totals = (
  document: { readonly totalExcludingVat: string; readonly vatTotal: string; readonly totalIncludingVat: string; readonly currency: string },
): ReadonlyArray<LabelledValue> => [
  { label: "Total fără TVA", value: money(document.totalExcludingVat, document.currency) },
  { label: "TVA", value: money(document.vatTotal, document.currency) },
  { label: "Total cu TVA", value: money(document.totalIncludingVat, document.currency) },
]

/**
 * Everything a document's body renders as, exported for the third one.
 *
 * The parameter is the shared body rather than a union of the two documents
 * modelled here, so the proforma projection — which has its own head and its own
 * file — composes the same five sections instead of restating them. Nothing in
 * it reads a head field; widening the type is what makes that a compile-time
 * fact rather than a convention.
 */
export const documentBodyView = (
  document: DocumentBody,
): Pick<DocumentSnapshotView, "heading" | "parties" | "lines" | "vatRows" | "totals"> => ({
  heading: `${document.series} ${String(document.number)}`,
  parties: [issuerView(document.issuer), customerView(document.customer)],
  lines: document.lines.map((line) => lineView(line, document.currency)),
  vatRows: document.vatBreakdown.map((entry) => vatRowView(entry, document.currency)),
  totals: totals(document),
})

export const projectIssuedInvoice = (invoice: IssuedInvoice): DocumentSnapshotView => ({
  ...documentBodyView(invoice),
  facts: [
    { label: "Emisă", value: invoice.issueDate },
    { label: "Scadență", value: orDash(invoice.dueDate) },
    { label: "Monedă", value: invoice.currency },
    ...invoice.eFacturaStatus === null ? [] : [{ label: "e-Factura", value: eFacturaStatusLabel(invoice.eFacturaStatus) }],
  ],
  notes: invoice.notes,
  originalInvoice: null,
})

/**
 * A correction keeps the negative sign the register stored it with.
 *
 * Its totals are not re-derived here — they arrive already signed from the
 * backend, and flipping or absolutizing them for display would misstate a
 * fiscal document.
 */
export const projectCorrectionDocument = (correction: CorrectionDocument): DocumentSnapshotView => ({
  ...documentBodyView(correction),
  facts: [
    { label: "Emisă", value: correction.issueDate },
    { label: "Monedă", value: correction.currency },
    { label: "Motiv", value: correction.reason },
  ],
  notes: null,
  originalInvoice: {
    label: "Vezi factura inițială",
    href: invoiceDetailHref(correction.originalInvoiceId),
  },
})
