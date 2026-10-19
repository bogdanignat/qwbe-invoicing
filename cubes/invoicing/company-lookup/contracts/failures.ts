import { Data } from "effect"

/**
 * A provider that could not answer. The host maps transport outcomes onto
 * `reason` and never carries the upstream body or the API key in it.
 * `auth_failed` is a rejected provider key, not a rejected session.
 */
export type ProviderFailureReason = "pending" | "quota_exceeded" | "auth_failed" | "unavailable"

export class ProviderFailure extends Data.TaggedError("ProviderFailure")<{
  readonly reason: ProviderFailureReason
  readonly retryAfterSeconds?: number
}> {}
