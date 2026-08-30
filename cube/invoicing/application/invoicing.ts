import { Effect } from "effect"

import {
  DomainConflict,
  PermissionDenied,
  ValidationFailure,
  type InvoicingFailure,
} from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, RequestContextProvider, TransactionalStore } from "../contracts/host.ts"
import { invoicingPermissions } from "../contracts/permissions.ts"
import { calculateTotals } from "../domain/calculation.ts"
import type { IssuedInvoice } from "../domain/invoice.ts"
import { createCorrectionOperations, type CorrectionOperations } from "./corrections.ts"
import { copyParty, createDraftingOperations, missing, type DraftingOperations } from "./drafting.ts"
import { createPaymentOperations, type PaymentOperations } from "./payments.ts"
import type { InvoicingTransaction } from "./ports.ts"

export interface InvoicingDependencies {
  readonly context: RequestContextProvider
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly store: TransactionalStore<InvoicingTransaction>
  readonly cubeIdentity: string
}

export interface InvoicingService extends DraftingOperations, PaymentOperations, CorrectionOperations {
  readonly issueInvoice: (input: { readonly draftId: string }) => Effect.Effect<IssuedInvoice, InvoicingFailure>
  readonly getIssuedInvoice: (id: string) => Effect.Effect<IssuedInvoice, InvoicingFailure>
}

export const createInvoicingService = (dependencies: InvoicingDependencies): InvoicingService => {
  const permissions = invoicingPermissions(dependencies.cubeIdentity)
  const authorized = (permission: string): Effect.Effect<RequestContext, InvoicingFailure> =>
    Effect.flatMap(dependencies.context.current, (context) =>
      context.identity.permissions.includes(permission)
        ? Effect.succeed(context)
        : Effect.fail(new PermissionDenied({ permission })))
  const drafting = createDraftingOperations(dependencies, permissions, authorized)
  const payments = createPaymentOperations(dependencies)
  const corrections = createCorrectionOperations(dependencies)

  const issueInvoice = (input: { readonly draftId: string }) => Effect.gen(function*() {
    const context = yield* authorized(permissions.issueInvoices)
    const invoiceId = yield* dependencies.ids.next
    const issuedAt = yield* dependencies.clock.now
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const draft = yield* transaction.findDraft(context.organization.id, input.draftId)
      if (draft === undefined) return yield* Effect.fail(missing("draft", input.draftId))
      if (draft.status !== "draft") {
        return yield* Effect.fail(new DomainConflict({ code: "invoice_already_issued", message: "Draft was already issued" }))
      }
      if (draft.lines.length === 0) {
        return yield* Effect.fail(new ValidationFailure({ issues: ["invoice must contain at least one line"] }))
      }
      const issuer = yield* transaction.findIssuer(context.organization.id)
      if (issuer === undefined) return yield* Effect.fail(missing("issuer", context.organization.id))
      const customer = yield* transaction.findCustomer(context.organization.id, draft.customerId)
      if (customer === undefined) return yield* Effect.fail(missing("customer", draft.customerId))
      const fiscalYear = Number(draft.issueDate.slice(0, 4))
      const number = yield* transaction.allocateInvoiceNumber(context.organization.id, fiscalYear, issuer.defaultSeries)
      const invoice: IssuedInvoice = {
        id: invoiceId,
        draftId: draft.id,
        organizationId: context.organization.id,
        series: issuer.defaultSeries,
        number,
        issueDate: draft.issueDate,
        dueDate: draft.dueDate,
        issuedAt: issuedAt.toISOString(),
        currency: draft.currency,
        issuer: copyParty(issuer),
        customer: copyParty(customer),
        lines: structuredClone(draft.lines),
        ...calculateTotals(draft.lines),
      }
      yield* transaction.saveIssuedInvoice(invoice)
      yield* transaction.saveDraft({ ...draft, status: "issued" })
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

  return { ...drafting, ...payments, ...corrections, issueInvoice, getIssuedInvoice }
}

export type { DraftInvoice, IssuedInvoice } from "../domain/invoice.ts"
export type { InvoicingTransaction } from "./ports.ts"
