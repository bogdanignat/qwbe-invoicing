import { Effect } from "effect"

import { checked, cursorText, pageOf, pageQuery, type Page, type PageRequest } from "../../../application/support.ts"
import { ResourceNotFound } from "../../../contracts/failures.ts"
import type { RequestContext } from "../../../contracts/host.ts"
import type { FetchRecord, ReceivedDependencies, ReceivedDetail, ReceivedFailure, ReceivedScope, ReceivedSummary } from "./ports.ts"

/** The page polls this: the organization's latest fetch in the current environment, and how far its invoices are fetched completely. */
export interface ReceivedStatus {
  readonly fetch: FetchRecord | undefined
  readonly coveredUntil: string | undefined
}

type Authorized = (permission: string) => Effect.Effect<RequestContext, ReceivedFailure>

const notFound = (id: string) => Effect.fail(new ResourceNotFound({ resource: "efactura_received", id }))

const receivedPageQuery = (page: PageRequest | undefined) => checked(() => pageQuery(page, (raw) => ({
  spvCreatedAt: cursorText(raw.spvCreatedAt), messageId: cursorText(raw.messageId),
})))

/**
 * What a user reads of the received invoices, under `efactura:read`: always
 * the organization of the request in the current environment, so the id of
 * another organization's invoice, or of one fetched in the other environment,
 * is not found.
 */
export const receivedReads = (dependencies: ReceivedDependencies, authorized: Authorized) => {
  const { environment, permissions, store } = dependencies
  const scoped = <A>(read: (scope: ReceivedScope) => Effect.Effect<A, ReceivedFailure>) => Effect.flatMap(authorized(permissions.read),
    (context) => read({ organizationId: context.organization.id, environment }))

  const status: Effect.Effect<ReceivedStatus, ReceivedFailure> = scoped((scope) => store.transaction((transaction) => Effect.all({
    fetch: transaction.latestFetch(scope), coveredUntil: transaction.coveredUntil(scope.organizationId, scope.environment),
  })))

  const list = (page?: PageRequest): Effect.Effect<Page<ReceivedSummary>, ReceivedFailure> => scoped((scope) => Effect.gen(function*() {
    const query = yield* receivedPageQuery(page)
    const rows = yield* store.transaction((transaction) => transaction.listReceived(scope, query))
    return pageOf(rows, query, (row) => ({ spvCreatedAt: row.spvCreatedAt, messageId: row.messageId }))
  }))

  const detail = (id: string): Effect.Effect<ReceivedDetail, ReceivedFailure> => scoped((scope) =>
    Effect.flatMap(store.transaction((transaction) => transaction.findReceived(scope, id)),
      (found) => found === undefined ? notFound(id) : Effect.succeed(found)))

  const archive = (id: string): Effect.Effect<Uint8Array, ReceivedFailure> => scoped((scope) =>
    Effect.flatMap(store.transaction((transaction) => transaction.readArchive(scope, id)),
      (found) => found === undefined ? notFound(id) : Effect.succeed(found)))

  return { status, list, detail, archive }
}
