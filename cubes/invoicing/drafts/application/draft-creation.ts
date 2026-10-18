import { Effect } from "effect"

import { findIdempotencyReplay, idempotencyRecord } from "../../application/idempotency.ts"
import { recordAuditEvent, type Authorize, type OperationDependencies } from "../../application/support.ts"
import { DomainConflict, type InvoicingFailure } from "../../contracts/failures.ts"
import type { CreateDraftInput } from "../../domain/inputs.ts"
import type { DraftInvoice, Idempotent } from "../../domain/invoice.ts"
import { authorDocument, type AuthoringTransaction } from "./authoring.ts"

/**
 * Creating a draft carries the same idempotency guarantee as issuing a document:
 * the replay lookup is the first thing the transaction does, and the header, the
 * lines, the record and the audit entry commit together or not at all.
 */
export const createDraftOperation = (
  dependencies: OperationDependencies<AuthoringTransaction>,
  permission: string,
  authorize: Authorize,
) =>
  ({ request: input, idempotency }: Idempotent<CreateDraftInput>): Effect.Effect<DraftInvoice, InvoicingFailure> =>
    Effect.gen(function*() {
      const context = yield* authorize(permission)
      const org = context.organization.id
      return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
        const replayId = yield* findIdempotencyReplay(transaction, org, idempotency, "create_draft", "draft")
        if (replayId !== undefined) {
          // The draft the key produced is returned as it stands now, edited or
          // issued. Deleted is a dead end: recreating it would hand a second
          // document to a caller that already saw the first one.
          const replay = yield* transaction.findDraft(org, replayId)
          return replay === undefined
            ? yield* Effect.fail(new DomainConflict({
              code: "draft_creation_result_deleted", message: "The draft this idempotency key created was deleted",
            }))
            : structuredClone(replay)
        }
        const createdAt = yield* dependencies.clock.now
        const id = yield* dependencies.ids.next
        const { document } = yield* authorDocument(input, org, transaction, dependencies.ids)
        const draft: DraftInvoice = { id, ...document, status: "draft", sourceProformaId: null }
        yield* transaction.saveDraft(draft)
        yield* transaction.saveIdempotencyRecord(idempotencyRecord(org, idempotency, "create_draft", "draft", id, createdAt.toISOString()))
        yield* recordAuditEvent(transaction, context, dependencies.ids, createdAt, { action: "draft.created", targetKind: "draft", targetId: id })
        return structuredClone(draft)
      }))
    })
