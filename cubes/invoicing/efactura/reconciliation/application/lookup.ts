import { Effect } from "effect"

import {
  DomainConflict, PermissionDenied, ResourceNotFound, type AuthenticationRequired, type OrganizationContextMissing, type PersistenceFailure,
  type ValidationFailure,
} from "../../../contracts/failures.ts"
import type { RequestContext } from "../../../contracts/host.ts"
import type { SubmissionRecord } from "../../submissions/index.ts"
import type { ReconciliationDependencies, ReconciliationTransaction } from "./ports.ts"

export type ReconciliationFailure =
  | AuthenticationRequired | OrganizationContextMissing | PermissionDenied | DomainConflict | ResourceNotFound | ValidationFailure
  | PersistenceFailure

export const conflict = (code: string, message: string) => Effect.fail(new DomainConflict({ code, message }))

export const notUnknown = () => conflict("efactura_not_unknown", "only a current unknown submission can be reconciled")

/** Every reconciliation needs `efactura:reconcile`. */
export const authorized = (dependencies: ReconciliationDependencies): Effect.Effect<RequestContext, ReconciliationFailure> =>
  Effect.flatMap(dependencies.context.current, (context) => context.identity.permissions.includes(dependencies.permissions.reconcile)
    ? Effect.succeed(context) : Effect.fail(new PermissionDenied({ permission: dependencies.permissions.reconcile })))

/** The organization's submission, or 404. */
export const found = (transaction: ReconciliationTransaction, organizationId: string, id: string) =>
  Effect.flatMap(transaction.find(organizationId, id), (submission) => submission === undefined
    ? Effect.fail(new ResourceNotFound({ resource: "efactura_submission", id })) : Effect.succeed(submission))

/** The organization's submission, and only while it is a current `unknown` of this environment. */
export const currentUnknown = (dependencies: ReconciliationDependencies, transaction: ReconciliationTransaction, organizationId: string, id: string) =>
  Effect.flatMap(found(transaction, organizationId, id), (submission): Effect.Effect<SubmissionRecord, DomainConflict> =>
    submission.state !== "unknown" || submission.superseded || submission.environment !== dependencies.environment
      ? notUnknown() : Effect.succeed(submission))
