import { Effect } from "effect"

import type { InvoicingTransaction } from "../../application/ports.ts"
import { ValidationFailure, type PersistenceFailure } from "../../contracts/failures.ts"
import type { NumberedDocumentType } from "../../domain/invoice.ts"

export const ensureChronology = (tx: InvoicingTransaction, org: string, kind: NumberedDocumentType, series: string,
  issueDate: string, today: string): Effect.Effect<void, ValidationFailure | PersistenceFailure> => Effect.gen(function*() {
  if (issueDate > today) return yield* Effect.fail(new ValidationFailure({ issues: ["issueDate cannot be in the future"] }))
  const latest = yield* tx.findLatestIssueDate(org, Number(issueDate.slice(0, 4)), kind, series)
  if (latest !== undefined && issueDate < latest) return yield* Effect.fail(new ValidationFailure({
    issues: [`issueDate cannot be before ${latest}, the last ${kind} issued in series ${series}`],
  }))
})
