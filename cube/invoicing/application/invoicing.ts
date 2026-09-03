import { Effect } from "effect"

import {
  DomainConflict,
  PermissionDenied,
  ValidationFailure,
  type InvoicingFailure,
} from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, RequestContextProvider, TransactionalStore } from "../contracts/host.ts"
import { invoicingPermissions } from "../contracts/permissions.ts"
import type { AuthoringDocumentInput, AuthoringProformaInput, ConvertProformaInput, DraftInvoice, IssueProformaInput, IssuedInvoice, Proforma } from "../domain/invoice.ts"
import { createCorrectionOperations, type CorrectionOperations } from "./corrections.ts"
import { authorDocument } from "./draft-authoring.ts"
import { createDraftingOperations, type DraftingOperations } from "./drafting.ts"
import { createPaymentOperations, type PaymentOperations } from "./payments.ts"
import type { InvoicingTransaction } from "./ports.ts"
import { copyParty, missing } from "./support.ts"

type SnapshotContent = Omit<DraftInvoice, "id" | "status" | "customerId">
const numberedSnapshot = (
  draft: SnapshotContent,
  issuer: Parameters<typeof copyParty>[0],
  identity: { readonly id: string; readonly series: string; readonly number: number; readonly issuedAt: Date },
) => ({
  ...identity, issuedAt: identity.issuedAt.toISOString(), organizationId: draft.organizationId,
  issueDate: draft.issueDate, dueDate: draft.dueDate, currency: draft.currency,
  issuer: copyParty(issuer), customer: structuredClone(draft.customer), lines: structuredClone(draft.lines),
  taxBreakdown: structuredClone(draft.taxBreakdown), totalExcludingTax: draft.totalExcludingTax,
  taxTotal: draft.taxTotal, totalIncludingTax: draft.totalIncludingTax,
})
const issuanceSource = (
  input: AuthoringDocumentInput | { readonly draftId: string }, organizationId: string,
  transaction: InvoicingTransaction, ids: IdGenerator, kind: "invoice" | "proforma",
) => Effect.gen(function*() {
  if (!("draftId" in input)) return { ...(yield* authorDocument(input, organizationId, transaction, ids)), draft: undefined }
  const draft = yield* transaction.findDraft(organizationId, input.draftId)
  if (draft === undefined) return yield* Effect.fail(missing("draft", input.draftId))
  if (draft.status !== "draft") return yield* Effect.fail(new DomainConflict({
    code: kind === "invoice" ? "invoice_already_issued" : "draft_already_issued", message: "Draft was already used",
  }))
  if (draft.lines.length === 0) return yield* Effect.fail(new ValidationFailure({ issues: [`${kind} must contain at least one line`] }))
  const issuer = yield* transaction.findIssuer(organizationId)
  return issuer === undefined ? yield* Effect.fail(missing("issuer", organizationId)) : { document: draft, issuer, draft }
})

export interface InvoicingDependencies {
  readonly context: RequestContextProvider
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly store: TransactionalStore<InvoicingTransaction>
  readonly cubeIdentity: string
}

type Operation<Input, Output> = (input: Input) => Effect.Effect<Output, InvoicingFailure>
type Listing<Output> = () => Effect.Effect<ReadonlyArray<Output>, InvoicingFailure>
export interface InvoicingService extends DraftingOperations, PaymentOperations, CorrectionOperations {
  readonly issueInvoice: Operation<AuthoringDocumentInput | { readonly draftId: string }, IssuedInvoice>
  readonly getIssuedInvoice: Operation<string, IssuedInvoice>
  readonly listIssuedInvoices: Listing<IssuedInvoice>
  readonly issueProforma: Operation<AuthoringProformaInput | IssueProformaInput, Proforma>
  readonly issueInvoiceFromProforma: Operation<ConvertProformaInput, IssuedInvoice>
  readonly getProforma: Operation<string, Proforma>
  readonly listProformas: Listing<Proforma>
}

export const createInvoicingService = (dependencies: InvoicingDependencies): InvoicingService => {
  const permissions = invoicingPermissions(dependencies.cubeIdentity)
  const authorized = (permission: string): Effect.Effect<RequestContext, InvoicingFailure> =>
    Effect.flatMap(dependencies.context.current, (context) =>
      context.identity.permissions.includes(permission)
        ? Effect.succeed(context)
        : Effect.fail(new PermissionDenied({ permission })))
  const drafting = createDraftingOperations(dependencies, permissions, authorized)
  const payments = createPaymentOperations(dependencies, permissions, authorized)
  const corrections = createCorrectionOperations(dependencies, permissions, authorized)

  const issueInvoice = (input: AuthoringDocumentInput | { readonly draftId: string }) => Effect.gen(function*() {
    const context = yield* authorized(permissions.issueInvoices)
    const invoiceId = yield* dependencies.ids.next
    const issuedAt = yield* dependencies.clock.now
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const { document, issuer, draft } = yield* issuanceSource(input, context.organization.id, transaction, dependencies.ids, "invoice")
      const number = yield* transaction.allocateDocumentNumber(context.organization.id, Number(document.issueDate.slice(0, 4)), "invoice", document.series)
      const invoice: IssuedInvoice = {
        draftId: draft?.id ?? null, sourceProformaId: null,
        ...numberedSnapshot(document, issuer, { id: invoiceId, series: document.series, number, issuedAt }),
        eFacturaStatus: "not_sent",
      }
      yield* transaction.saveIssuedInvoice(invoice)
      if (draft !== undefined) yield* transaction.saveDraft({ ...draft, status: "issued" })
      return structuredClone(invoice)
    }))
  })

  const getIssuedInvoice = (id: string) => Effect.gen(function*() {
    const context = yield* authorized(permissions.read)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const invoice = yield* transaction.findIssuedInvoice(context.organization.id, id)
      if (invoice === undefined) return yield* Effect.fail(missing("invoice", id))
      return structuredClone(invoice)
    }))
  })

  const listIssuedInvoices = () => Effect.gen(function*() {
    const context = yield* authorized(permissions.read)
    const invoices = yield* dependencies.store.transaction((transaction) =>
      transaction.listIssuedInvoices(context.organization.id))
    return structuredClone(invoices)
  })

  const issueProforma = (input: AuthoringProformaInput | IssueProformaInput) => Effect.gen(function*() {
    const context = yield* authorized(permissions.issueProformas)
    const id = yield* dependencies.ids.next
    const issuedAt = yield* dependencies.clock.now
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const { document, issuer, draft } = yield* issuanceSource(input, context.organization.id, transaction, dependencies.ids, "proforma")
      const proformaSeries = "draftId" in input ? input.series : input.proformaSeries
      const series = yield* transaction.findDocumentSeries(context.organization.id, "proforma", proformaSeries)
      if (series === undefined) return yield* Effect.fail(missing("document_series", proformaSeries))
      const proforma: Proforma = {
        sourceDraftId: draft?.id ?? null, invoiceSeries: document.series, convertedDraftId: null, convertedInvoiceId: null,
        ...numberedSnapshot(document, issuer, { id, series: series.series,
          number: yield* transaction.allocateDocumentNumber(context.organization.id, Number(document.issueDate.slice(0, 4)), "proforma", series.series),
          issuedAt }),
      }
      yield* transaction.saveProforma(proforma)
      if (draft !== undefined) yield* transaction.saveDraft({ ...draft, status: "proforma_issued" })
      return structuredClone(proforma)
    }))
  })

  const issueInvoiceFromProforma = (input: ConvertProformaInput) => Effect.gen(function*() {
    const context = yield* authorized(permissions.issueInvoices)
    const id = yield* dependencies.ids.next
    const convertedAt = yield* dependencies.clock.now
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const proforma = yield* transaction.findProforma(context.organization.id, input.proformaId)
      if (proforma === undefined) return yield* Effect.fail(missing("proforma", input.proformaId))
      if ((yield* transaction.findProformaConversion(context.organization.id, proforma.id))
        || (yield* transaction.findProformaInvoiceConversion(context.organization.id, proforma.id))) {
        return yield* Effect.fail(new DomainConflict({ code: "proforma_already_converted", message: "Proforma was already converted" }))
      }
      const invoice: IssuedInvoice = {
        draftId: null, sourceProformaId: proforma.id, eFacturaStatus: "not_sent",
        ...numberedSnapshot(proforma, proforma.issuer, { id, series: proforma.invoiceSeries,
          number: yield* transaction.allocateDocumentNumber(context.organization.id, Number(proforma.issueDate.slice(0, 4)), "invoice", proforma.invoiceSeries),
          issuedAt: convertedAt }),
      }
      yield* transaction.saveIssuedInvoice(invoice)
      yield* transaction.saveProformaInvoiceConversion({ proformaId: proforma.id, organizationId: context.organization.id,
        resultingInvoiceId: invoice.id, actorId: context.identity.id, convertedAt: convertedAt.toISOString() })
      return structuredClone(invoice)
    }))
  })

  const getProforma = (id: string) => Effect.gen(function*() {
    const context = yield* authorized(permissions.read)
    const value = yield* dependencies.store.transaction((transaction) => transaction.findProforma(context.organization.id, id))
    return value === undefined ? yield* Effect.fail(missing("proforma", id)) : structuredClone(value)
  })

  const listProformas = () => Effect.gen(function*() {
    const context = yield* authorized(permissions.read)
    return structuredClone(yield* dependencies.store.transaction((transaction) => transaction.listProformas(context.organization.id)))
  })

  return { ...drafting, ...payments, ...corrections, issueInvoice, getIssuedInvoice, listIssuedInvoices,
    issueProforma, issueInvoiceFromProforma, getProforma, listProformas }
}

export type { DraftInvoice, IssuedInvoice, Proforma } from "../domain/invoice.ts"
export type { InvoicingTransaction } from "./ports.ts"
