import { Effect } from "effect"

import { findIdempotencyReplay, idempotencyRecord, missingIdempotencyResult } from "../../application/idempotency.ts"
import { missing, type Authorize, type OperationDependencies } from "../../application/support.ts"
import { DomainConflict, type InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { ConvertProformaInput } from "../../domain/inputs.ts"
import type { Idempotent, IssuedInvoice } from "../../domain/invoice.ts"
import { fiscalYear, numberedSnapshot } from "./snapshot.ts"

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
      const invoice: IssuedInvoice = {
        draftId: null, sourceProformaId: proforma.id, eFacturaStatus: "not_sent",
        ...numberedSnapshot(proforma, proforma.issuer, { id, series: proforma.invoiceSeries,
          number: yield* transaction.allocateDocumentNumber(context.organization.id, fiscalYear(proforma.issueDate), "invoice", proforma.invoiceSeries),
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
