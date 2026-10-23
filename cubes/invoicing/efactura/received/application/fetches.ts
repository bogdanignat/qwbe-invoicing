import { Effect } from "effect"

import { DomainConflict, PermissionDenied } from "../../../contracts/failures.ts"
import type { RequestContext } from "../../../contracts/host.ts"
import { connectionStatus, spvCif } from "../../connection/index.ts"
import { fetchWindow } from "../domain/fetching.ts"
import type { FetchRecord, ReceivedDependencies, ReceivedFailure, ReceivedTransaction } from "./ports.ts"
import { receivedReads } from "./reads.ts"

export interface Requested {
  readonly fetch: FetchRecord
  /** `false`: a fetch was already active and is answered instead. */
  readonly created: boolean
}

const conflict = (code: string, message: string) => Effect.fail(new DomainConflict({ code, message }))

/** The CIF a fetch lists for: the current issuer's, and only while the connection is usable and verified for it. */
const fetchableCif = (transaction: ReceivedTransaction, organizationId: string, at: Date) => Effect.gen(function*() {
  const connection = yield* transaction.findConnection(organizationId)
  if (connectionStatus(true, connection, at) !== "connected" || connection?.verifiedCif === undefined) {
    return yield* conflict("efactura_not_connected", "connect to ANAF e-Factura first")
  }
  const cif = spvCif((yield* transaction.findIssuerFiscalIdentifier(organizationId)) ?? "")
  if (cif !== connection.verifiedCif) {
    return yield* conflict("efactura_cif_mismatch", "the ANAF connection is verified for another CIF than the issuer's")
  }
  return cif
})

/**
 * Received invoices are fetched only when a user asks: this records the
 * request, and the dispatcher carries it out in the background. One fetch is
 * active per organization and environment; asking again while it runs answers
 * that one. All of it happens in one transaction, so two clicks at once make
 * one fetch. What was fetched is read through `receivedReads`.
 */
export const createReceivedService = (dependencies: ReceivedDependencies) => {
  const { clock, environment, ids, permissions, store } = dependencies

  const authorized = (permission: string): Effect.Effect<RequestContext, ReceivedFailure> => Effect.flatMap(dependencies.context.current,
    (context) => context.identity.permissions.includes(permission) ? Effect.succeed(context) : Effect.fail(new PermissionDenied({ permission })))

  const requestFetch = (): Effect.Effect<Requested, ReceivedFailure> => Effect.gen(function*() {
    const context = yield* authorized(permissions.receive)
    if (!dependencies.configured) return yield* conflict("efactura_not_configured", "ANAF e-Factura is not configured")
    const organizationId = context.organization.id
    const [id, now] = yield* Effect.all([ids.next, clock.now])
    return yield* store.transaction((transaction) => Effect.gen(function*() {
      const cif = yield* fetchableCif(transaction, organizationId, now)
      const active = yield* transaction.activeFetch(organizationId, environment)
      if (active !== undefined) return { fetch: active, created: false }
      const window = fetchWindow(now, yield* transaction.coveredUntil(organizationId, environment))
      const fetch = yield* transaction.insertFetch({
        id, organizationId, environment, cif, window, createdBy: context.identity.id, createdAt: now.toISOString() })
      return { fetch, created: true }
    }))
  })

  return { requestFetch, ...receivedReads(dependencies, authorized) }
}

export type ReceivedService = ReturnType<typeof createReceivedService>
