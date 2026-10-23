import { Effect, Either } from "effect"

import { FETCH_FAILURES, type FetchRecord } from "../../../cubes/invoicing/efactura/received/index.ts"
import type { MessageCall } from "../../storage/postgres-efactura-budgets.ts"
import { receivedStore, type ReceivedStore } from "../../storage/postgres-efactura-received-dispatch.ts"
import type { Answer, StepContext } from "./dispatch-calls.ts"
import type { AccessToken } from "./credentials.ts"

/**
 * What a fetch's steps are made of, like a submission's: a call reserved in
 * one fenced transaction, made outside any, and settled in another. A fetch
 * has no call log: `efactura_submission_attempts` belongs to submissions.
 */
export const writing = <A>(ctx: StepContext, write: (store: ReceivedStore) => Promise<A>) =>
  ctx.lease.run((client) => write(receivedStore(client, ctx.now())))

/** Reserves one call of the organization (and of the message), or puts the fetch off until the budget allows it. */
export const reservedCall = (ctx: StepContext, fetch: FetchRecord, message?: MessageCall) => writing(ctx, async (store) => {
  const waitUntil = await store.reserve(fetch.organizationId, message)
  if (waitUntil !== undefined) await store.wait(fetch, waitUntil)
  return waitUntil === undefined
})

/** The result transaction of a call: a 429 pauses the whole organization first, and the step's write learns until when. */
export const settled = <B, A>(ctx: StepContext, fetch: FetchRecord, answer: Answer<B>,
  write: (store: ReceivedStore, paused: string | undefined) => Promise<A>) => writing(ctx, async (store) => {
  const { reply } = answer
  const paused = Either.isRight(reply) && reply.right.status === 429 ? await store.pause(fetch.organizationId, reply.right.retryAfter) : undefined
  return write(store, paused)
})

/** After a 401/403: one refresh, as for a submission. With a new pair the fetch goes on at once; without, it fails. */
export const afterRefusal = (ctx: StepContext, fetch: FetchRecord, token: AccessToken) => Effect.gen(function*() {
  const fresh = yield* ctx.credentials.refused(fetch.organizationId, token)
  yield* writing(ctx, (store) => fresh ? store.wait(fetch, ctx.now().toISOString()) : store.fail(fetch, [FETCH_FAILURES.tokenRefused]))
})
