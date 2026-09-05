import { Effect } from "effect"

import { DomainConflict, PersistenceFailure, ValidationFailure, type InvoicingFailure } from "../contracts/failures.ts"
import type {
  IdempotencyAttempt,
  IdempotencyOperation,
  IdempotencyRecord,
  IdempotencyResultKind,
} from "../domain/invoice.ts"
import type { InvoicingTransaction } from "./ports.ts"

const validateAttempt = (attempt: IdempotencyAttempt): Effect.Effect<void, ValidationFailure> => {
  const validKey = /^[\x21-\x7e]{1,255}$/.test(attempt.key)
  const validFingerprint = /^sha256:[a-f0-9]{64}$/.test(attempt.fingerprint)
  return validKey && validFingerprint
    ? Effect.void
    : Effect.fail(new ValidationFailure({ issues: [validKey ? "idempotency fingerprint is invalid" : "Idempotency-Key is invalid"] }))
}

export const findIdempotencyReplay = (
  transaction: InvoicingTransaction,
  organizationId: string,
  attempt: IdempotencyAttempt,
  operation: IdempotencyOperation,
  resultKind: IdempotencyResultKind,
): Effect.Effect<string | undefined, InvoicingFailure> => Effect.gen(function*() {
  yield* validateAttempt(attempt)
  const existing = yield* transaction.findIdempotencyRecord(organizationId, attempt.key)
  if (existing === undefined) return undefined
  if (existing.operation !== operation || existing.fingerprint !== attempt.fingerprint || existing.resultKind !== resultKind) {
    return yield* Effect.fail(new DomainConflict({
      code: "idempotency_key_reused",
      message: "Idempotency key was already used for a different request",
    }))
  }
  return existing.resultId
})

export const idempotencyRecord = (
  organizationId: string,
  attempt: IdempotencyAttempt,
  operation: IdempotencyOperation,
  resultKind: IdempotencyResultKind,
  resultId: string,
  createdAt: string,
): IdempotencyRecord => ({ organizationId, ...attempt, operation, resultKind, resultId, createdAt })

export const missingIdempotencyResult = (resultKind: IdempotencyResultKind) =>
  new PersistenceFailure({ operation: `load ${resultKind} idempotency result` })
