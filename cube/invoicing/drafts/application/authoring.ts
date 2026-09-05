import { Effect } from "effect"

import type { InvoicingTransaction } from "../../application/ports.ts"
import { checked, copyBuyer, copySource, missing } from "../../application/support.ts"
import { DomainConflict, ValidationFailure, type InvoicingFailure } from "../../contracts/failures.ts"
import type { IdGenerator } from "../../contracts/host.ts"
import { calculateLine, calculateTotals } from "../../domain/calculation.ts"
import type { BuyerSnapshot, DocumentSource, DraftInvoice } from "../../domain/invoice.ts"
import type { AuthoringDocumentInput, CreateDraftInput, UpdateDraftInput } from "../../domain/inputs.ts"
import { resolveVatConfiguration, validateBuyer, validateDate, validateDocumentSeries, validateDocumentSource } from "../../domain/validation.ts"

export const withTotals = (draft: Omit<DraftInvoice, "vatBreakdown" | "totalExcludingVat" | "vatTotal" | "totalIncludingVat">): DraftInvoice => ({
  ...draft,
  ...calculateTotals(draft.lines),
})

const editable = (draft: DraftInvoice): Effect.Effect<DraftInvoice, DomainConflict> => draft.status === "draft"
  ? Effect.succeed(draft)
  : Effect.fail(new DomainConflict({
    code: draft.status === "proforma_issued" ? "draft_already_issued" : "invoice_already_issued",
    message: "Issued drafts cannot be edited",
  }))

export const findEditable = (transaction: InvoicingTransaction, organizationId: string, id: string) => Effect.gen(function*() {
  const draft = yield* transaction.findDraft(organizationId, id)
  if (draft === undefined) return yield* Effect.fail(missing("draft", id))
  return yield* editable(draft)
})

export const buyerFrom = (
  input: CreateDraftInput | UpdateDraftInput | AuthoringDocumentInput,
  organizationId: string,
  transaction: InvoicingTransaction,
): Effect.Effect<{ readonly customer: BuyerSnapshot; readonly customerId?: string }, InvoicingFailure> => Effect.gen(function*() {
  const customerId = "customerId" in input && typeof input.customerId === "string" ? input.customerId : undefined
  const inline = "customer" in input ? input.customer : undefined
  yield* checked(() => {
    if ((customerId === undefined) === (inline === undefined)) {
      throw new ValidationFailure({ issues: ["exactly one of customerId or customer is required"] })
    }
    if (customerId !== undefined && customerId.trim() === "") {
      throw new ValidationFailure({ issues: ["customerId is required"] })
    }
  })
  if (customerId !== undefined) {
    const customer = yield* transaction.findCustomer(organizationId, customerId)
    if (customer === undefined || customer.deletedAt !== undefined) return yield* Effect.fail(missing("customer", customerId))
    return { customer: copyBuyer(customer), customerId: customer.id }
  }
  const customer = copyBuyer(inline as BuyerSnapshot)
  yield* checked(() => { validateBuyer(customer) })
  return { customer }
})

export const dates = (issueDate: string, dueDate: string | null | undefined) => checked(() => {
  validateDate(issueDate, "issueDate")
  const due = dueDate ?? null
  if (due !== null) validateDate(due, "dueDate")
  if (due !== null && due < issueDate) throw new ValidationFailure({ issues: ["dueDate cannot be before issueDate"] })
  return { issueDate, dueDate: due }
})

export const documentSource = (source: DocumentSource | undefined) => checked(() => {
  if (source === undefined) return undefined
  validateDocumentSource(source)
  return copySource(source)
})

export const authorDocument = (
  input: AuthoringDocumentInput | CreateDraftInput,
  organizationId: string,
  transaction: InvoicingTransaction,
  ids: IdGenerator,
) => Effect.gen(function*() {
  yield* checked(() => {
    validateDocumentSeries({ organizationId, documentType: "invoice", series: input.series })
    if (input.currency !== undefined && input.currency !== "RON") throw new ValidationFailure({ issues: ["currency must be RON"] })
    if ("lines" in input && input.lines.length === 0) throw new ValidationFailure({ issues: ["document must contain at least one line"] })
  })
  const issuer = yield* transaction.findIssuer(organizationId)
  if (issuer === undefined) return yield* Effect.fail(missing("issuer", organizationId))
  const series = yield* transaction.findDocumentSeries(organizationId, "invoice", input.series)
  if (series === undefined) return yield* Effect.fail(missing("document_series", input.series))
  const customer = yield* buyerFrom(input, organizationId, transaction)
  const header = yield* dates(input.issueDate, input.dueDate)
  const source = yield* documentSource(input.source)
  const lines = yield* Effect.forEach("lines" in input ? input.lines : [], (line) => Effect.flatMap(ids.next, (id) =>
    checked(() => calculateLine({ ...line, id, vat: resolveVatConfiguration(issuer, line.vatRateCode, input.issueDate) }))))
  return { issuer, document: { organizationId, ...customer, ...(source === undefined ? {} : { source }), series: series.series, ...header, currency: "RON" as const,
    lines, ...calculateTotals(lines) } }
})
