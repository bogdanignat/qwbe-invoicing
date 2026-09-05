import { Effect } from "effect"

import { findIdempotencyReplay, idempotencyRecord, missingIdempotencyResult } from "../../application/idempotency.ts"
import { ensureChronology, missing, type Authorize, type OperationDependencies } from "../../application/support.ts"
import { DomainConflict, type InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { ConvertProformaInput } from "../../domain/inputs.ts"
import type { Idempotent, IssuedInvoice } from "../../domain/invoice.ts"
import { calendarDate } from "../../domain/validation.ts"
import { fiscalYear, numberedSnapshot } from "./snapshot.ts"

const dayMs = 86_400_000
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs)
const shiftDate = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10)

export interface ProformaConversionOperations {
  readonly issueInvoiceFromProforma: (input: Idempotent<ConvertProformaInput>) => Effect.Effect<IssuedInvoice, InvoicingFailure>
}

export const createProformaConversionOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): ProformaConversionOperations => {
  const issueInvoiceFromProforma = ({ request: input, idempotency }: Idempotent<ConvertProformaInput>) => Effect.gen(function*() {
    const context = yield* authorize(permissions.issueInvoices)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const operation = "issue_invoice_from_proforma"
      const replayId = yield* findIdempotencyReplay(transaction, context.organization.id, idempotency, operation, "invoice")
      if (replayId !== undefined) {
        const replay = yield* transaction.findIssuedInvoice(context.organization.id, replayId)
        return replay === undefined ? yield* Effect.fail(missingIdempotencyResult("invoice")) : structuredClone(replay)
      }
      const proforma = yield* transaction.findProforma(context.organization.id, input.proformaId)
      if (proforma === undefined) return yield* Effect.fail(missing("proforma", input.proformaId))
      if ((yield* transaction.findProformaConversion(context.organization.id, proforma.id))
        || (yield* transaction.findProformaInvoiceConversion(context.organization.id, proforma.id))) {
        return yield* Effect.fail(new DomainConflict({ code: "proforma_already_converted", message: "Proforma was already converted" }))
      }
      const id = yield* dependencies.ids.next
      const convertedAt = yield* dependencies.clock.now
      // The invoice is dated the day it is issued (Codul fiscal art. 319 (20) b), not the day the proforma was;
      // the payment term negotiated on the proforma is carried over as the same number of days.
      const issueDate = calendarDate(convertedAt)
      const dueDate = proforma.dueDate === null ? null : shiftDate(issueDate, daysBetween(proforma.issueDate, proforma.dueDate))
      yield* ensureChronology(transaction, context.organization.id, "invoice", proforma.invoiceSeries, issueDate, issueDate)
      const invoice: IssuedInvoice = {
        draftId: null, sourceProformaId: proforma.id, eFacturaStatus: "not_sent",
        ...numberedSnapshot({ ...proforma, issueDate, dueDate }, proforma.issuer, { id, series: proforma.invoiceSeries,
          number: yield* transaction.allocateDocumentNumber(context.organization.id, fiscalYear(issueDate), "invoice", proforma.invoiceSeries),
          issuedAt: convertedAt }),
      }
      yield* transaction.saveIssuedInvoice(invoice)
      yield* transaction.saveProformaInvoiceConversion({ proformaId: proforma.id, organizationId: context.organization.id,
        resultingInvoiceId: invoice.id, actorId: context.identity.id, convertedAt: convertedAt.toISOString() })
      yield* transaction.saveIdempotencyRecord(idempotencyRecord(
        context.organization.id, idempotency, operation, "invoice", invoice.id, convertedAt.toISOString(),
      ))
      return structuredClone(invoice)
    }))
  })

  return { issueInvoiceFromProforma }
}
