import { Effect } from "effect"

import { DomainConflict, ValidationFailure, type PaymentsFailure } from "../contracts/failures.ts"
import type { IdempotencyAttempt, PaymentIdempotencyRecord, PaymentOperation } from "../domain/payments.ts"
import type { PaymentsTransaction } from "./ports.ts"

export const validateAttempt = (attempt: IdempotencyAttempt): Effect.Effect<void, ValidationFailure> => {
  const validKey = /^[\x21-\x7e]{1,255}$/.test(attempt.key)
  const validFingerprint = /^sha256:[a-f0-9]{64}$/.test(attempt.fingerprint)
  return validKey && validFingerprint
    ? Effect.void
    : Effect.fail(new ValidationFailure({ issues: [validKey ? "idempotency fingerprint is invalid" : "Idempotency-Key is invalid"] }))
}

// Returns the id of the payment row an identical earlier request produced, or fails when the key was reused for a different request.
export const findReplay = (
  transaction: PaymentsTransaction, organizationId: string, attempt: IdempotencyAttempt, operation: PaymentOperation,
): Effect.Effect<string | undefined, PaymentsFailure> => Effect.gen(function*() {
  const existing = yield* transaction.findIdempotencyRecord(organizationId, attempt.key)
  if (existing === undefined) return undefined
  if (existing.operation !== operation || existing.fingerprint !== attempt.fingerprint) {
    return yield* Effect.fail(new DomainConflict({ code: "idempotency_key_reused", message: "Idempotency key was already used for a different request" }))
  }
  return existing.resultId
})

export const idempotencyRecord = (
  organizationId: string, attempt: IdempotencyAttempt, operation: PaymentOperation, resultId: string, createdAt: string,
): PaymentIdempotencyRecord => ({ organizationId, ...attempt, operation, resultId, createdAt })
