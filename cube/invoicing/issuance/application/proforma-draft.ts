import { Effect } from "effect"
import { findIdempotencyReplay, idempotencyRecord, missingIdempotencyResult } from "../../application/idempotency.ts"
import { checked, copyBuyer, recordAuditEvent, type Authorize, type OperationDependencies } from "../../application/support.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import { calculateTotals, validateFiscalDocument } from "../../domain/calculation.ts"
import type { DraftInvoice, Idempotent } from "../../domain/invoice.ts"
import type { ConvertProformaInput } from "../domain/proforma.ts"
import type { InvoicingTransaction } from "../../application/ports.ts"
import { conversionDates, conversionSource } from "./proforma-conversion-context.ts"
import type { ProformaTransaction } from "./ports.ts"

export const createProformaDraftOperation = (dependencies: OperationDependencies<InvoicingTransaction & ProformaTransaction>, permissions: InvoicingPermissions, authorize: Authorize) =>
  ({ request: input, idempotency }: Idempotent<ConvertProformaInput>) => Effect.gen(function*() {
    const context = yield* authorize(permissions.draftInvoices)
    const org = context.organization.id
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const operation = "create_draft_invoice_from_proforma"
      const replayId = yield* findIdempotencyReplay(transaction, org, idempotency, operation, "draft")
      if (replayId !== undefined) {
        const replay = yield* transaction.findDraft(org, replayId)
        return replay === undefined ? yield* Effect.fail(missingIdempotencyResult("draft")) : structuredClone(replay)
      }
      const proforma = yield* conversionSource(transaction, org, input)
      yield* checked(() => { validateFiscalDocument(proforma) })
      const convertedAt = yield* dependencies.clock.now
      const id = yield* dependencies.ids.next
      // Copy the offered lines; normal draft editing/issuance will validate any later VAT/date changes.
      const lines = yield* Effect.forEach(proforma.lines, (line) => Effect.map(dependencies.ids.next, (lineId) => ({ ...structuredClone(line), id: lineId })))
      const draft: DraftInvoice = { id, organizationId: org, series: input.invoiceSeries, status: "draft",
        sourceProformaId: proforma.id, ...conversionDates(proforma, convertedAt), currency: proforma.currency,
        customer: copyBuyer(proforma.customer), ...(proforma.source === undefined ? {} : { source: structuredClone(proforma.source) }),
        notes: proforma.notes, lines, ...calculateTotals(lines) }
      yield* transaction.saveDraft(draft)
      yield* transaction.saveProformaConversion({ proformaId: proforma.id, organizationId: org, resultingDraftId: id,
        actorId: context.identity.id, convertedAt: convertedAt.toISOString() })
      yield* transaction.saveIdempotencyRecord(idempotencyRecord(org, idempotency, operation, "draft", id, convertedAt.toISOString()))
      yield* recordAuditEvent(transaction, context, dependencies.ids, convertedAt, { action: "proforma.converted", targetKind: "proforma", targetId: proforma.id })
      yield* recordAuditEvent(transaction, context, dependencies.ids, convertedAt, { action: "draft.created", targetKind: "draft", targetId: id })
      return structuredClone(draft)
    }))
  })
