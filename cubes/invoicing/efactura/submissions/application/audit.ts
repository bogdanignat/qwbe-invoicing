import type { AuditEvent } from "../../../domain/invoice.ts"
import type { FiscalState } from "../domain/states.ts"

/** The states a submission is audited on arriving in, the restore that turns it `unknown`, and the two ways out of `unknown`. */
export type SubmissionAuditAction =
  | Extract<FiscalState, "queued" | "accepted" | "rejected" | "refused" | "unknown"> | "restored_unknown" | "linked" | "resubmitted"

const AUDITED: ReadonlyArray<FiscalState> = ["queued", "accepted", "rejected", "refused", "unknown"]

/** The audit action of a transition into `state`, or `undefined` for the steps in between. */
export const auditedArrival = (state: FiscalState): SubmissionAuditAction | undefined =>
  AUDITED.find((audited) => audited === state) as SubmissionAuditAction | undefined

export interface AuditedSubmission {
  readonly id: string
  readonly organizationId: string
}

/** `efactura_submission.<action>`, appended in the transaction that makes the change. */
export const submissionAudit = (
  eventId: string, submission: AuditedSubmission, actorId: string, at: string, action: SubmissionAuditAction, reason?: string,
): AuditEvent => ({
  id: eventId, organizationId: submission.organizationId, actorId, occurredAt: at, action: `efactura_submission.${action}`,
  targetKind: "efactura_submission", targetId: submission.id, ...(reason === undefined ? {} : { reason }),
})
