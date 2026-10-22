import { Data } from "effect"

import { ValidationFailure } from "../../contracts/failures.ts"

export class AuthenticationRequired extends Data.TaggedError("AuthenticationRequired") {}
export class OrganizationContextMissing extends Data.TaggedError("OrganizationContextMissing") {}
export class PermissionDenied extends Data.TaggedError("PermissionDenied")<{ readonly permission: string }> {}
// The parent's class, so the parent's `checked` turns a thrown validation into a typed failure with its issues.
export { ValidationFailure }
export class ResourceNotFound extends Data.TaggedError("ResourceNotFound")<{
  readonly resource: string
  readonly id: string
}> {}
export class DomainConflict extends Data.TaggedError("DomainConflict")<{
  readonly code: string
  readonly message: string
}> {}
export class PersistenceFailure extends Data.TaggedError("PersistenceFailure")<{
  readonly operation: string
}> {}

export type PaymentsFailure = AuthenticationRequired | OrganizationContextMissing | PermissionDenied
  | ValidationFailure | ResourceNotFound | DomainConflict | PersistenceFailure
