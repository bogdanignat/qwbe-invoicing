import { Effect, Either } from "effect"

import type { AnafEnvironment } from "../../../cubes/invoicing/efactura/connection/index.ts"
import type { AnafReply, CallOutcome, SubmissionRecord } from "../../../cubes/invoicing/efactura/submissions/index.ts"
import type { SendFailure } from "../../outbound/send.ts"
import { dispatchStore, type CallRecord, type DispatchStore, type MessageCall } from "../../storage/postgres-efactura-dispatch.ts"
import type { DispatcherLease } from "../../storage/postgres-efactura-lease.ts"
import type { SubmissionGateway } from "../anaf/submission-gateway.ts"
import type { AccessToken, DispatcherCredentials } from "./credentials.ts"

/**
 * What every step of the dispatcher is made of: a call reserved in one fenced
 * transaction, made outside any, and settled (logged, a 429 pause, the step's
 * write) in another.
 */
export interface StepContext {
  readonly lease: DispatcherLease
  readonly gateway: SubmissionGateway
  readonly credentials: DispatcherCredentials
  readonly environment: AnafEnvironment
  readonly now: () => Date
}

/** A queued or polled submission whose organization has no usable connection waits this long before it is looked at again. */
export const DISCONNECTED_WAIT_MS = 15 * 60_000
export const RETRY_WAIT_MS = 60_000
export const ARCHIVE_WAIT_MS = 60 * 60_000

export type Answer<B> = { readonly at: Date; readonly reply: Either.Either<AnafReply<B>, SendFailure>; readonly durationMs: number }

export const later = (at: Date, ms: number) => new Date(at.getTime() + ms).toISOString()

export const timed = <B>(ctx: StepContext, request: Effect.Effect<AnafReply<B>, SendFailure>) => Effect.gen(function*() {
  const at = ctx.now()
  const started = performance.now()
  const reply = yield* Effect.either(request)
  return { at, reply, durationMs: Math.round(performance.now() - started) } satisfies Answer<B>
})

const ANSWERED_BADLY: Readonly<Record<string, CallOutcome>> = {
  invalid: "anaf_error", refused: "anaf_error", anaf_error: "anaf_error", unrecognized: "unrecognized", ambiguous: "unrecognized",
}

const record = <B>(operation: CallRecord["operation"], answer: Answer<B>, kind: string): CallRecord => {
  const { reply } = answer
  const status = Either.isRight(reply) ? reply.right.status : undefined
  const outcome: CallOutcome = Either.isLeft(reply) ? reply.left.reason
    : status === 401 || status === 403 ? "auth_refused" : status === 429 ? "rate_limited" : ANSWERED_BADLY[kind] ?? "answered"
  return { operation, outcome, httpStatus: status, durationMs: answer.durationMs, startedAt: answer.at.toISOString() }
}

/** The result transaction of a call: its log line, a 429 pause, then what the step writes. Answers the pause, if any. */
export const settle = <B, A>(ctx: StepContext, submission: SubmissionRecord, operation: CallRecord["operation"], answer: Answer<B>, kind: string,
  write: (store: DispatchStore, paused: string | undefined) => Promise<A>) => ctx.lease.run(async (client) => {
  const store = dispatchStore(client, ctx.now())
  await store.log(submission, record(operation, answer, kind))
  const { reply } = answer
  const paused = Either.isRight(reply) && reply.right.status === 429 ? await store.pause(submission.organizationId, reply.right.retryAfter) : undefined
  return write(store, paused)
})

/** Reserves the call (and runs `before`) in one transaction, or reschedules the submission and answers `undefined`. */
export const reserved = <A>(ctx: StepContext, submission: SubmissionRecord, message: MessageCall | undefined, before: (store: DispatchStore) => Promise<A>) =>
  ctx.lease.run(async (client) => {
    const store = dispatchStore(client, ctx.now())
    const waitUntil = await store.reserve(submission.organizationId, message)
    if (waitUntil === undefined) return { value: await before(store) }
    await store.move(submission, undefined, { nextAttemptAt: waitUntil })
    return undefined
  })

/** After a 401/403: one refresh, and the submission is due again at once if it gave a new pair. */
export const afterRefusal = (ctx: StepContext, submission: SubmissionRecord, token: AccessToken) => Effect.gen(function*() {
  if (!(yield* ctx.credentials.refused(submission.organizationId, token))) return
  yield* ctx.lease.run((client) => dispatchStore(client, ctx.now()).move(submission, undefined, { nextAttemptAt: ctx.now().toISOString() }))
})

export const kindOf = <B, K extends { readonly kind: string }>(answer: Answer<B>, classify: (reply: AnafReply<B>) => K, fallback: K): K =>
  Either.isRight(answer.reply) ? classify(answer.reply.right) : fallback
