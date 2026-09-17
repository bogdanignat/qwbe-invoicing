import { Data } from "effect"

/**
 * The generator refuses to emit a document it cannot render faithfully. Every
 * refusal names the offending fields, because a silently dropped or truncated
 * element becomes an invalid invoice at ANAF, not a local warning.
 */
export class EFacturaContractViolation extends Data.TaggedError("EFacturaContractViolation")<{
  readonly issues: ReadonlyArray<string>
}> {}

export type EFacturaFailure = EFacturaContractViolation
