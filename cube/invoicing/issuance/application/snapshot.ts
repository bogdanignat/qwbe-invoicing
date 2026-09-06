import { Effect } from "effect"

import type { InvoicingTransaction } from "../../application/ports.ts"
import { copyParty, copySource, missing } from "../../application/support.ts"
import { DomainConflict, ValidationFailure } from "../../contracts/failures.ts"
import type { IdGenerator } from "../../contracts/host.ts"
import type { DraftInvoice, IssuerProfile, PartySnapshot } from "../../domain/invoice.ts"
import type { AuthoringDocumentInput } from "../../domain/inputs.ts"
import { resolveVatConfiguration } from "../../domain/validation.ts"
import { authorDocument } from "../../drafts/index.ts"

type SnapshotContent = Omit<DraftInvoice, "id" | "status" | "customerId">

export interface NumberedIdentity {
  readonly id: string
  readonly series: string
  readonly number: number
  readonly issuedAt: Date
  readonly actorId: string
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
  if (issuer === undefined) return yield* Effect.fail(missing("issuer", organizationId))
  if (draft.lines.some((line) => staleVat(issuer, line, draft.issueDate))) {
    return yield* Effect.fail(new ValidationFailure({ issues: ["draft lines carry a VAT rate that is no longer configured on the issue date; re-add the affected lines"] }))
  }
  return { document: draft, issuer, draft }
})

// Lines keep the VAT resolved when they were added; if the issuer's configuration moved since, the
// numbers on the draft are no longer what the law asks on the issue date, so issuance stops here.
const staleVat = (issuer: IssuerProfile, line: DraftInvoice["lines"][number], issueDate: string): boolean => {
  try {
    return Number(resolveVatConfiguration(issuer, line.vatRateCode, issueDate).rate) !== Number(line.vatRate)
  } catch {
    return true
  }
}
