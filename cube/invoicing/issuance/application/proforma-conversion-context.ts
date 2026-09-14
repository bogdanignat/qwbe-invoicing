import { Effect } from "effect"
import type { InvoicingTransaction } from "../../application/ports.ts"
import { checked, missing } from "../../application/support.ts"
import { DomainConflict } from "../../contracts/failures.ts"
import { calendarDate, validateDocumentSeries } from "../../domain/validation.ts"
import type { ConvertProformaInput, Proforma } from "../domain/proforma.ts"

export const conversionSource = (tx: InvoicingTransaction, org: string, input: ConvertProformaInput) => Effect.gen(function*() {
  const proforma = yield* tx.findProforma(org, input.proformaId)
  if (proforma === undefined) return yield* Effect.fail(missing("proforma", input.proformaId))
  if ((yield* tx.findProformaConversion(org, proforma.id)) || (yield* tx.findProformaInvoiceConversion(org, proforma.id))) {
    return yield* Effect.fail(new DomainConflict({ code: "proforma_already_converted", message: "Proforma was already converted" }))
  }
  yield* checked(() => { validateDocumentSeries({ organizationId: org, documentType: "invoice", series: input.invoiceSeries }) })
  if ((yield* tx.findDocumentSeries(org, "invoice", input.invoiceSeries)) === undefined) {
    return yield* Effect.fail(missing("document_series", input.invoiceSeries))
  }
  return proforma
})

// Both conversion routes start on the server's current date and retain the agreed payment term.
export const conversionDates = (proforma: Proforma, now: Date) => {
  const issueDate = calendarDate(now)
  const dayMs = 86_400_000
  const term = proforma.dueDate === null ? null
    : Math.round((Date.parse(`${proforma.dueDate}T00:00:00Z`) - Date.parse(`${proforma.issueDate}T00:00:00Z`)) / dayMs)
  const dueDate = term === null ? null : new Date(Date.parse(`${issueDate}T00:00:00Z`) + term * dayMs).toISOString().slice(0, 10)
  return { issueDate, dueDate }
}
