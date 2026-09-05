import { Effect } from "effect"

import type { InvoicingTransaction } from "../../application/ports.ts"
import { copyParty, copySource, missing } from "../../application/support.ts"
import { DomainConflict, ValidationFailure } from "../../contracts/failures.ts"
import type { IdGenerator } from "../../contracts/host.ts"
import type { AuthoringDocumentInput, DraftInvoice, PartySnapshot } from "../../domain/invoice.ts"
import { authorDocument } from "../../drafts/index.ts"

type SnapshotContent = Omit<DraftInvoice, "id" | "status" | "customerId">

export interface NumberedIdentity {
  readonly id: string
  readonly series: string
  readonly number: number
  readonly issuedAt: Date
}

export const fiscalYear = (isoDate: string): number => Number(isoDate.slice(0, 4))

export const numberedSnapshot = (draft: SnapshotContent, issuer: PartySnapshot, identity: NumberedIdentity) => ({
  ...identity, issuedAt: identity.issuedAt.toISOString(), organizationId: draft.organizationId,
  ...(draft.source === undefined ? {} : { source: copySource(draft.source) }),
  issueDate: draft.issueDate, dueDate: draft.dueDate, currency: draft.currency,
  issuer: copyParty(issuer), customer: structuredClone(draft.customer), lines: structuredClone(draft.lines),
  vatBreakdown: structuredClone(draft.vatBreakdown), totalExcludingVat: draft.totalExcludingVat,
  vatTotal: draft.vatTotal, totalIncludingVat: draft.totalIncludingVat,
})

export const issuanceSource = (
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
