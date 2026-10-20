import { Effect } from "effect"

import { ValidationFailure } from "../../../contracts/failures.ts"
import { anafId, documentStatus, fiscalTransition, submissionAudit, type SubmissionRecord } from "../../submissions/index.ts"
import { isOwnUpload, listWindow } from "../domain/listing.ts"
import { listPage, listedByAnaf, reachable } from "./listing.ts"
import { authorized, conflict, currentUnknown, notUnknown, type ReconciliationFailure } from "./lookup.ts"
import type { ReconciliationDependencies, ReconciliationTransaction } from "./ports.ts"
import { resubmit, type DocumentLoader } from "./resubmit.ts"

export interface Candidate {
  readonly uploadIndex: string
  /** ANAF's `data_creare`, `YYYYMMDDHHmm`. */
  readonly createdAt: string
  readonly type: string
  /** Another submission of the organization already holds this index: it is not offered for linking. */
  readonly linked: boolean
}

export interface Candidates {
  readonly page: number
  readonly pages: number
  /** The window asked for, ISO instants. */
  readonly from: string
  readonly to: string
  readonly candidates: ReadonlyArray<Candidate>
}

/**
 * Reconciliation of an `unknown` submission, by hand and on explicit
 * confirmation only: see what ANAF lists for its CIF and window, link an index
 * that list shows, or resubmit knowing ANAF may then hold the document twice.
 * Nothing here opens a ZIP or links anything on its own.
 */
export const createReconciliationService = (dependencies: ReconciliationDependencies) => {
  const { clock, environment, ids, store } = dependencies

  /** A current `unknown` submission and the stored pair to ask ANAF about it with. */
  const unknownOne = (organizationId: string, id: string) => Effect.flatMap(
    store.transaction((transaction) => currentUnknown(dependencies, transaction, organizationId, id)),
    (submission) => reachable(dependencies, submission))

  /** One page of ANAF's list in the submission's window, only the uploads of its CIF. */
  const candidates = (id: string, page: number): Effect.Effect<Candidates, ReconciliationFailure> => Effect.gen(function*() {
    const context = yield* authorized(dependencies)
    const target = yield* unknownOne(context.organization.id, id)
    const listed = yield* listPage(dependencies, target, page)
    const window = listWindow(target.submission.createdAt, yield* clock.now)
    const own = listed.messages.filter(isOwnUpload)
    // Local data only: which of these indexes another submission already holds. No further ANAF call.
    const held = yield* store.transaction((transaction) => Effect.forEach(own,
      ({ uploadIndex }) => transaction.findByUploadIndex(context.organization.id, environment, uploadIndex)))
    return {
      page, pages: listed.pages, from: new Date(window.startTime).toISOString(), to: new Date(window.endTime).toISOString(),
      candidates: own.map(({ createdAt, type, uploadIndex }, index) => ({ uploadIndex, createdAt, type, linked: held[index] !== undefined })),
    }
  })

  const unlinked = (transaction: ReconciliationTransaction, organizationId: string, uploadIndex: string) =>
    Effect.flatMap(transaction.findByUploadIndex(organizationId, environment, uploadIndex), (holder) => holder === undefined
      ? Effect.void : conflict("efactura_index_linked", "this upload index already belongs to another submission"))

  /**
   * The user's confirmation that `uploadIndex` is this document, checked
   * against ANAF's own list for the CIF and window before anything is written.
   * Then, in one transaction: `unknown → processing` with the index, the
   * document's status and the audit. Polling is the dispatcher's.
   */
  const link = (id: string, uploadIndex: string, confirmed: boolean): Effect.Effect<SubmissionRecord, ReconciliationFailure> =>
    Effect.gen(function*() {
      const context = yield* authorized(dependencies)
      const index = anafId(uploadIndex)
      if (!confirmed || index === undefined) {
        return yield* Effect.fail(new ValidationFailure({ issues: ["uploadIndex must be ANAF's digits and confirmed must be true"] }))
      }
      const organizationId = context.organization.id
      const target = yield* unknownOne(organizationId, id)
      yield* store.transaction((transaction) => unlinked(transaction, organizationId, index))
      if (!(yield* listedByAnaf(dependencies, target, index))) {
        return yield* conflict("efactura_index_not_listed", "ANAF does not list this upload index for the submission's CIF and window")
      }
      const [auditId, now] = yield* Effect.all([ids.next, clock.now])
      const at = now.toISOString()
      return yield* store.transaction((transaction) => Effect.gen(function*() {
        const still = yield* currentUnknown(dependencies, transaction, organizationId, id)
        yield* unlinked(transaction, organizationId, index)
        const state = fiscalTransition(still.state, "linked")
        if (state === undefined) return yield* notUnknown()
        const linked = yield* transaction.link(still, state, index, at)
        yield* transaction.project(organizationId, linked.documentKind, linked.documentId, documentStatus(state))
        yield* transaction.appendAuditEvent(submissionAudit(auditId, linked, context.identity.id, at, "linked", `upload_index:${index}`))
        return linked
      }))
    })

  return {
    candidates,
    link,
    resubmit: <E>(id: string, confirmed: boolean, load: DocumentLoader<E>) => resubmit(dependencies, id, confirmed, load),
  }
}

export type ReconciliationService = ReturnType<typeof createReconciliationService>
