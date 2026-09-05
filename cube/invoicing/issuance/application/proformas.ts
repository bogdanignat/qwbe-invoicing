import { Effect } from "effect"

import { findIdempotencyReplay, idempotencyRecord, missingIdempotencyResult } from "../../application/idempotency.ts"
import { checked, documentPageQuery, missing, pageOf, type Authorize, type OperationDependencies, type Page, type PageRequest } from "../../application/support.ts"
import { DomainConflict, type InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { AuthoringProformaInput, ConvertProformaInput, DocumentSource, Idempotent, IssueProformaInput, IssuedInvoice, Proforma } from "../../domain/invoice.ts"
import { validateDocumentSource } from "../../domain/validation.ts"
import { fiscalYear, issuanceSource, numberedSnapshot } from "./snapshot.ts"

export interface ProformaOperations {
  readonly issueProforma: (input: Idempotent<AuthoringProformaInput | IssueProformaInput>) => Effect.Effect<Proforma, InvoicingFailure>
  readonly issueInvoiceFromProforma: (input: Idempotent<ConvertProformaInput>) => Effect.Effect<IssuedInvoice, InvoicingFailure>
  readonly getProforma: (id: string) => Effect.Effect<Proforma, InvoicingFailure>
  readonly listProformas: (source?: DocumentSource, page?: PageRequest) => Effect.Effect<Page<Proforma>, InvoicingFailure>
}

export const createProformaOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): ProformaOperations => {
  const issueProforma = ({ request: input, idempotency }: Idempotent<AuthoringProformaInput | IssueProformaInput>) => Effect.gen(function*() {
    const context = yield* authorize(permissions.issueProformas)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const operation = "draftId" in input ? "issue_proforma_from_draft" : "issue_proforma_direct"
      const replayId = yield* findIdempotencyReplay(transaction, context.organization.id, idempotency, operation, "proforma")
      if (replayId !== undefined) {
        const replay = yield* transaction.findProforma(context.organization.id, replayId)
        return replay === undefined ? yield* Effect.fail(missingIdempotencyResult("proforma")) : structuredClone(replay)
      }
      const { document, issuer, draft } = yield* issuanceSource(input, context.organization.id, transaction, dependencies.ids, "proforma")
      const id = yield* dependencies.ids.next
      const issuedAt = yield* dependencies.clock.now
      const proformaSeries = "draftId" in input ? input.series : input.proformaSeries
      const series = yield* transaction.findDocumentSeries(context.organization.id, "proforma", proformaSeries)
      if (series === undefined) return yield* Effect.fail(missing("document_series", proformaSeries))
      const proforma: Proforma = {
        sourceDraftId: draft?.id ?? null, invoiceSeries: document.series, convertedDraftId: null, convertedInvoiceId: null,
        ...numberedSnapshot(document, issuer, { id, series: series.series,
          number: yield* transaction.allocateDocumentNumber(context.organization.id, fiscalYear(document.issueDate), "proforma", series.series),
          issuedAt }),
      }
      yield* transaction.saveProforma(proforma)
      if (draft !== undefined) yield* transaction.saveDraft({ ...draft, status: "proforma_issued" })
      yield* transaction.saveIdempotencyRecord(idempotencyRecord(
        context.organization.id, idempotency, operation, "proforma", proforma.id, issuedAt.toISOString(),
      ))
      return structuredClone(proforma)
    }))
  })

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

  const getProforma = (id: string) => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    const value = yield* dependencies.store.transaction((transaction) => transaction.findProforma(context.organization.id, id))
    return value === undefined ? yield* Effect.fail(missing("proforma", id)) : structuredClone(value)
  })

  const listProformas = (source?: DocumentSource, page?: PageRequest) => Effect.gen(function*() {
    if (source !== undefined) yield* checked(() => { validateDocumentSource(source) })
    const query = yield* checked(() => documentPageQuery(page))
    const context = yield* authorize(permissions.read)
    const rows = yield* dependencies.store.transaction((transaction) => transaction.listProformas(context.organization.id, query, source))
    return pageOf(rows, query, (proforma) => ({ issueDate: proforma.issueDate, number: proforma.number, id: proforma.id }))
  })

  return { issueProforma, issueInvoiceFromProforma, getProforma, listProformas }
}
