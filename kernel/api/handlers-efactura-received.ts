import { randomUUID } from "node:crypto"

import { Effect } from "effect"

import type { PageRequest } from "../../cubes/invoicing/index.ts"
import { efacturaPermissions } from "../../cubes/invoicing/efactura/connection/index.ts"
import { createReceivedService, type ReceivedService } from "../../cubes/invoicing/efactura/received/index.ts"
import { createPostgresReceivedStore } from "../storage/postgres-efactura-received.ts"
import { CurrentRequest } from "./api-context.ts"
import { errors } from "./api-failures.ts"
import { attachment, safeFilename } from "./api-responses.ts"
import type { ApiRuntime } from "./api-types.ts"

type Path = { readonly path: { readonly id: string } }

/**
 * The received-invoice routes. A fetch is only recorded here, never carried
 * out: the dispatcher calls ANAF in the background. Every read is of the
 * request's organization in the current environment, under `efactura:read`.
 */
export const receivedHandlers = (runtime: ApiRuntime) => {
  const environment = runtime.anaf?.environment ?? "test"
  const store = createPostgresReceivedStore(runtime.pool, environment)
  const received = <A, E>(operation: (service: ReceivedService) => Effect.Effect<A, E>) => Effect.flatMap(CurrentRequest,
    (context) => operation(createReceivedService({
      context: { current: Effect.succeed(context) }, permissions: efacturaPermissions("efactura"),
      clock: { now: Effect.sync(runtime.now ?? (() => new Date())) }, ids: { next: Effect.sync(randomUUID) },
      store, configured: runtime.anaf?.client !== undefined, environment,
    })))
  return {
    requestFetch: () => received((s) => s.requestFetch()).pipe(Effect.map(({ fetch }) => fetch), Effect.mapError(errors("DomainConflict"))),
    status: () => received((s) => s.status).pipe(Effect.map(({ fetch, coveredUntil }) => ({ fetch: fetch ?? null, coveredUntil: coveredUntil ?? null })),
      Effect.mapError(errors())),
    list: ({ urlParams }: { readonly urlParams: PageRequest }) => received((s) => s.list(urlParams)).pipe(Effect.mapError(errors("ValidationFailure"))),
    detail: ({ path }: Path) => received((s) => s.detail(path.id)).pipe(Effect.mapError(errors("ResourceNotFound"))),
    archive: ({ path }: Path) => received((s) => s.archive(path.id)).pipe(
      Effect.map((bytes) => attachment(bytes, "application/zip", `efactura-primita-${safeFilename(path.id, "spv")}.zip`)),
      Effect.mapError(errors("ResourceNotFound"))),
  }
}
