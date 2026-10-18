import { Effect } from "effect"

import { checked, copyBuyer, copyIssuerSnapshot, copySource, missing } from "../../application/support.ts"
import { DomainConflict, ValidationFailure } from "../../contracts/failures.ts"
import type { IdGenerator } from "../../contracts/host.ts"
import type { DraftInvoice, IssuerSnapshot } from "../../domain/invoice.ts"
import { validateFiscalDocument } from "../../domain/calculation.ts"
import type { AuthoringDocumentInput } from "../../domain/inputs.ts"
import { authorDocument, type AuthoringTransaction } from "../../drafts/index.ts"
import { currentVatRegistration, validateVatForIssuance, type IssuerProfile } from "../../issuer/index.ts"
import type { AuthoringProformaInput } from "../domain/proforma.ts"

type SnapshotContent = Omit<DraftInvoice, "id" | "status" | "customerId" | "sourceProformaId">

export interface NumberedIdentity {
  readonly actorId: string
  readonly id: string
  readonly series: string
  readonly number: number
  readonly issuedAt: Date
}

export const fiscalYear = (isoDate: string): number => Number(isoDate.slice(0, 4))

const issuerAtIssuance = (issuer: IssuerProfile, document: SnapshotContent) => checked((): IssuerSnapshot => {
  validateFiscalDocument(document)
  validateVatForIssuance(issuer, document.issueDate, document.lines)
  const registration = currentVatRegistration(issuer.vatConfigurations, document.issueDate)
  if (registration === undefined) throw new ValidationFailure({ issues: [`issuer VAT registration must be configured on ${document.issueDate}`] })
  return copyIssuerSnapshot({ ...issuer, vatRegistered: registration.registered })
})

export const numberedSnapshot = (draft: SnapshotContent, issuer: IssuerSnapshot, identity: NumberedIdentity) => ({
  ...identity, issuedAt: identity.issuedAt.toISOString(), organizationId: draft.organizationId,
  ...(draft.source === undefined ? {} : { source: copySource(draft.source) }),
  issueDate: draft.issueDate, dueDate: draft.dueDate, currency: draft.currency, notes: draft.notes,
  issuer: copyIssuerSnapshot(issuer), customer: copyBuyer(draft.customer), lines: structuredClone(draft.lines),
  vatBreakdown: structuredClone(draft.vatBreakdown), totalExcludingVat: draft.totalExcludingVat,
  vatTotal: draft.vatTotal, totalIncludingVat: draft.totalIncludingVat,
})

export const issuanceSource = (
  input: AuthoringDocumentInput | AuthoringProformaInput | { readonly draftId: string }, organizationId: string,
  transaction: AuthoringTransaction, ids: IdGenerator, kind: "invoice" | "proforma",
) => Effect.gen(function*() {
  if (!("draftId" in input)) {
    const payload = "proformaSeries" in input ? { ...input, series: input.proformaSeries } : input
    const source = { ...(yield* authorDocument(payload, organizationId, transaction, ids, kind)), draft: undefined }
    // Drafts may be empty; a document being issued may not. The rule lives on
    // the issuance path only, so authoring stays shared with draft creation.
    if (source.document.lines.length === 0) return yield* Effect.fail(new ValidationFailure({ issues: ["document must contain at least one line"] }))
    return { ...source, issuer: yield* issuerAtIssuance(source.issuer, source.document) }
  }
  const draft = yield* transaction.findDraft(organizationId, input.draftId)
  if (draft === undefined) return yield* Effect.fail(missing("draft", input.draftId))
  if (kind === "proforma" && draft.sourceProformaId !== null) return yield* Effect.fail(new DomainConflict({
    code: "derived_draft_cannot_issue_proforma", message: "A draft linked to a proforma can only become an invoice",
  }))
  if (draft.status !== "draft") return yield* Effect.fail(new DomainConflict({
    code: kind === "invoice" ? "invoice_already_issued" : "draft_already_issued", message: "Draft was already used",
  }))
  if (draft.lines.length === 0) return yield* Effect.fail(new ValidationFailure({ issues: [`${kind} must contain at least one line`] }))
  const issuer = yield* transaction.findIssuer(organizationId)
  if (issuer === undefined) return yield* Effect.fail(missing("issuer", organizationId))
  return { document: draft, issuer: yield* issuerAtIssuance(issuer, draft), draft }
})
