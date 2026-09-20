import { Effect } from "effect"

import { findIdempotencyReplay, idempotencyRecord, missingIdempotencyResult } from "../../application/idempotency.ts"
import { checked, missing, recordAuditEvent, type Authorize, type OperationDependencies } from "../../application/support.ts"
import type { InvoicingTransaction } from "../../application/ports.ts"
import { ValidationFailure, type InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { DraftInvoice, Idempotent, IssuedInvoice } from "../../domain/invoice.ts"
import { validateFiscalDocument } from "../../domain/calculation.ts"
import { currentVatRegistration, validateIssuerForIssuance, validateVatForIssuance, type IssuerTransaction } from "../../issuer/index.ts"
import type { ConvertProformaInput } from "../domain/proforma.ts"
import { fiscalYear, numberedSnapshot } from "./snapshot.ts"
import { ensureChronology } from "./chronology.ts"
import { validateInvoiceDueDate } from "./invoices.ts"
import { conversionDates, conversionSource } from "./proforma-conversion-context.ts"
import { createProformaDraftOperation } from "./proforma-draft.ts"
import type { ProformaTransaction } from "./ports.ts"

export interface ProformaConversionOperations {
  readonly issueInvoiceFromProforma: (input: Idempotent<ConvertProformaInput>) => Effect.Effect<IssuedInvoice, InvoicingFailure>
  readonly createDraftInvoiceFromProforma: (input: Idempotent<ConvertProformaInput>) => Effect.Effect<DraftInvoice, InvoicingFailure>
}

type ConversionTransaction = InvoicingTransaction & ProformaTransaction & Pick<IssuerTransaction, "findIssuer">

export const createProformaConversionOperations = (
  dependencies: OperationDependencies<ConversionTransaction>,
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
      const proforma = yield* conversionSource(transaction, context.organization.id, input)
      yield* checked(() => {
        validateFiscalDocument(proforma)
        validateIssuerForIssuance(proforma.issuer)
      })
      const convertedAt = yield* dependencies.clock.now
      const { issueDate, dueDate } = conversionDates(proforma, convertedAt)
      const issuer = yield* transaction.findIssuer(context.organization.id)
      if (issuer === undefined) return yield* Effect.fail(missing("issuer", context.organization.id))
      yield* checked(() => {
        validateVatForIssuance(issuer, issueDate, proforma.lines)
        if (currentVatRegistration(issuer.vatConfigurations, issueDate)?.registered !== proforma.issuer.vatRegistered) {
          throw new ValidationFailure({ issues: ["issuer VAT registration changed since the proforma was issued"] })
        }
        validateInvoiceDueDate({ dueDate, totalIncludingVat: proforma.totalIncludingVat })
      })
      yield* ensureChronology(transaction, context.organization.id, "invoice", input.invoiceSeries, issueDate, issueDate)
      const id = yield* dependencies.ids.next
      const invoice: IssuedInvoice = {
        draftId: null, sourceProformaId: proforma.id, eFacturaStatus: "not_sent",
        ...numberedSnapshot({ ...proforma, issueDate, dueDate }, proforma.issuer, { id, series: input.invoiceSeries,
          number: yield* transaction.allocateDocumentNumber(context.organization.id, fiscalYear(issueDate), "invoice", input.invoiceSeries),
          issuedAt: convertedAt, actorId: context.identity.id }),
      }
      yield* transaction.saveIssuedInvoice(invoice)
      yield* transaction.saveProformaInvoiceConversion({ proformaId: proforma.id, organizationId: context.organization.id,
        resultingInvoiceId: invoice.id, actorId: context.identity.id, convertedAt: convertedAt.toISOString() })
      yield* transaction.saveIdempotencyRecord(idempotencyRecord(
        context.organization.id, idempotency, operation, "invoice", invoice.id, convertedAt.toISOString(),
      ))
      yield* recordAuditEvent(transaction, context, dependencies.ids, convertedAt, {
        action: "proforma.converted", targetKind: "proforma", targetId: proforma.id,
      })
      yield* recordAuditEvent(transaction, context, dependencies.ids, convertedAt, {
        action: "invoice.issued", targetKind: "invoice", targetId: invoice.id,
      })
      return structuredClone(invoice)
    }))
  })

  return { issueInvoiceFromProforma, createDraftInvoiceFromProforma: createProformaDraftOperation(dependencies, permissions, authorize) }
}
