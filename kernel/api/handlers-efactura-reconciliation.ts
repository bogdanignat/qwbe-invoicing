import { randomUUID } from "node:crypto"

import { type Context, Effect } from "effect"

import { efacturaPermissions } from "../../cubes/invoicing/efactura/connection/index.ts"
import { createReconciliationService, type ReconciliationService } from "../../cubes/invoicing/efactura/reconciliation/index.ts"
import { requestAnaf } from "../efactura/reconciliation/request-anaf.ts"
import { createPostgresReconciliationStore } from "../storage/postgres-efactura-reconciliation.ts"
import { CurrentRequest } from "./api-context.ts"
import { errors } from "./api-failures.ts"
import { efacturaDocuments } from "./efactura-documents.ts"
import { submitted } from "./handlers-efactura-submissions.ts"
import type { ApiRuntime } from "./api-types.ts"

type Path = { readonly path: { readonly id: string } }

/**
 * The reconciliation routes of an `unknown` submission. ANAF is reached with
 * the stored pair only (a request never refreshes it), and a resubmit loads
 * the document from its frozen snapshot under the invoicing grants.
 */
export const reconciliationHandlers = (runtime: ApiRuntime) => {
  const now = runtime.now ?? (() => new Date())
  const environment = runtime.anaf?.environment ?? "test"
  const store = createPostgresReconciliationStore(runtime.pool, environment)
  const anaf = runtime.anaf === undefined ? undefined : requestAnaf(runtime.pool, runtime.anaf, runtime.transport ?? fetch, now)
  const { load } = efacturaDocuments(runtime)
  type Operation<A, E> = (service: ReconciliationService, context: Context.Tag.Service<CurrentRequest>) => Effect.Effect<A, E>
  const reconciliation = <A, E>(operation: Operation<A, E>) =>
    Effect.flatMap(CurrentRequest, (context) => operation(createReconciliationService({
      context: { current: Effect.succeed(context) }, permissions: efacturaPermissions("efactura"),
      clock: { now: Effect.sync(now) }, ids: { next: Effect.sync(randomUUID) }, store, anaf, environment,
    }), context))
  return {
    candidates: ({ path, urlParams }: Path & { readonly urlParams: { readonly page?: number } }) =>
      reconciliation((s) => s.candidates(path.id, urlParams.page ?? 1)).pipe(Effect.mapError(errors("ResourceNotFound", "DomainConflict"))),
    link: ({ path, payload }: Path & { readonly payload: { readonly uploadIndex: string; readonly confirmed: boolean } }) =>
      reconciliation((s) => s.link(path.id, payload.uploadIndex, payload.confirmed))
        .pipe(Effect.mapError(errors("ResourceNotFound", "ValidationFailure", "DomainConflict"))),
    resubmit: ({ path, payload }: Path & { readonly payload: { readonly confirmed: boolean } }) =>
      reconciliation((s, context) => s.resubmit(path.id, payload.confirmed,
        (kind, documentId) => Effect.provideService(load(kind, documentId), CurrentRequest, context))).pipe(Effect.flatMap(submitted),
        Effect.mapError(errors("ResourceNotFound", "ValidationFailure", "DomainConflict"))),
  }
}
