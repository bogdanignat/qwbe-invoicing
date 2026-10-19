import { Effect } from "effect"

import { ValidationFailure } from "../../../contracts/failures.ts"
import {
  canSupersede, checkedUpload, documentStatus, submissionAudit, type SubmissionDocument, type SubmissionRecord, type Submitted,
  type SubmittedKind,
} from "../../submissions/index.ts"
import { authorized, found, notUnknown, type ReconciliationFailure } from "./lookup.ts"
import type { ReconciliationDependencies, ReconciliationTransaction } from "./ports.ts"

export type DocumentLoader<E> = (kind: SubmittedKind, documentId: string) => Effect.Effect<SubmissionDocument, E>

/** The submission that replaced `previous`, when it was already resubmitted: a repeated or concurrent resubmit creates nothing. */
const replacement = (transaction: ReconciliationTransaction, organizationId: string, previous: SubmissionRecord) => !previous.superseded
  ? Effect.succeed(undefined)
  : Effect.flatMap(transaction.replacement(organizationId, previous.id), (next) => next === undefined
    ? Effect.die(new Error("a superseded submission has no replacement"))
    : Effect.succeed<Submitted>({ submission: next, created: false }))

const resubmittable = (dependencies: ReconciliationDependencies, submission: SubmissionRecord) =>
  canSupersede(submission.state) && submission.environment === dependencies.environment ? Effect.void : notUnknown()

/**
 * A new submission in place of an `unknown` one, on the explicit confirmation
 * that ANAF's list proves nothing and ANAF may end up with the document twice.
 * The XML is generated again from the frozen snapshot and passes every check
 * of a submit. In one transaction, under the submissions key: the old one is
 * marked superseded (it stays `unknown`), the new one is queued, the link, the
 * document's status and the audit are written. Asked again, or twice at once,
 * it answers the replacement it already made.
 */
export const resubmit = <E>(dependencies: ReconciliationDependencies, id: string, confirmed: boolean, load: DocumentLoader<E>):
  Effect.Effect<Submitted, ReconciliationFailure | E> => Effect.gen(function*() {
  const { anaf, clock, environment, ids, store } = dependencies
  const context = yield* authorized(dependencies)
  if (!confirmed) return yield* Effect.fail(new ValidationFailure({ issues: ["confirmed must be true"] }))
  const organizationId = context.organization.id
  const seen = yield* store.transaction((transaction) => Effect.gen(function*() {
    const previous = yield* found(transaction, organizationId, id)
    return { previous, connection: yield* transaction.findConnection(organizationId), answered: yield* replacement(transaction, organizationId, previous) }
  }))
  if (seen.answered !== undefined) return seen.answered
  const { previous } = seen
  yield* resubmittable(dependencies, previous)
  const now = yield* clock.now
  const document = yield* load(previous.documentKind, previous.documentId)
  const { cif, xml } = yield* checkedUpload(anaf !== undefined, seen.connection, document, now)
  const [nextId, resubmittedAudit, queuedAudit] = yield* Effect.all([ids.next, ids.next, ids.next])
  const at = now.toISOString()
  const actorId = context.identity.id
  return yield* store.transaction((transaction) => Effect.gen(function*() {
    const latest = yield* found(transaction, organizationId, id)
    const raced = yield* replacement(transaction, organizationId, latest)
    if (raced !== undefined) return raced
    yield* resubmittable(dependencies, latest)
    yield* transaction.supersede(latest, at)
    const next = yield* transaction.insert({ id: nextId, organizationId, environment, documentKind: latest.documentKind,
      documentId: latest.documentId, cif, xml, createdBy: actorId, createdAt: at })
    yield* transaction.recordResubmission(organizationId, { previousId: latest.id, nextId, actorId, createdAt: at })
    yield* transaction.project(organizationId, next.documentKind, next.documentId, documentStatus(next.state))
    yield* transaction.appendAuditEvent(submissionAudit(resubmittedAudit, latest, actorId, at, "resubmitted", `next:${nextId}`))
    yield* transaction.appendAuditEvent(submissionAudit(queuedAudit, next, actorId, at, "queued", `previous:${latest.id}`))
    return { submission: next, created: true }
  }))
})
