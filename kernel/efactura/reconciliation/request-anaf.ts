import { Effect, Either } from "effect"
import type { Pool } from "pg"

import type { ReconciliationAnaf } from "../../../cubes/invoicing/efactura/reconciliation/index.ts"
import type { Transport } from "../../outbound/send.ts"
import { createPostgresConnectionStore } from "../../storage/postgres-efactura-connection.ts"
import type { AnafSettings } from "../anaf/config.ts"
import { createSubmissionGateway } from "../anaf/submission-gateway.ts"
import { usableToken } from "../dispatch/credentials.ts"

/**
 * ANAF as a reconciliation request reaches it: the stored pair, read and
 * never refreshed, and the read-only list, timed for the call log. `undefined`
 * while no ANAF client is configured.
 */
export const requestAnaf = (pool: Pool, settings: AnafSettings, transport: Transport, now: () => Date): ReconciliationAnaf | undefined => {
  if (settings.client === undefined) return undefined
  const connections = createPostgresConnectionStore(pool, settings.client, settings.environment)
  const gateway = createSubmissionGateway(settings.environment, transport)
  return {
    token: (organizationId) => Effect.map(connections.transaction((transaction) => transaction.findConnection(organizationId)), (record) => {
      const usable = usableToken(record, now())
      return usable === undefined || record === undefined ? undefined
        : { access: usable.access, verifiedCif: usable.verifiedCif, generation: record.generation, revision: record.revision }
    }),
    list: (token, query) => Effect.gen(function*() {
      const startedAt = now().toISOString()
      const started = performance.now()
      const reply = yield* Effect.either(gateway.list(token, query))
      return { reply: Either.isRight(reply) ? reply.right : reply.left.reason, startedAt, durationMs: Math.round(performance.now() - started) }
    }),
  }
}
