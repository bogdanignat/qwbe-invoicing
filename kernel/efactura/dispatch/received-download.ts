import { Effect, Either } from "effect"

import { interpretArchive, type FetchRecord } from "../../../cubes/invoicing/efactura/received/index.ts"
import { classifyDownload } from "../../../cubes/invoicing/efactura/submissions/index.ts"
import { readReceivedZip } from "../anaf/zip-reader.ts"
import { RETRY_WAIT_MS, kindOf, later, timed, type StepContext } from "./dispatch-calls.ts"
import type { AccessToken } from "./credentials.ts"
import { afterRefusal, reservedCall, settled, writing } from "./received-calls.ts"

/**
 * One step of a downloading fetch: the next message still to store, one
 * `descarcare` under its daily budget, then its archive and what was read out
 * of it; or one more failed attempt. When nothing is left to try, the fetch
 * completes (and moves the coverage, by the cube's rule).
 *
 * A ZIP from ANAF is kept even when it cannot be opened or read: the archive is
 * the original, the interpretation says why it is unreadable. Reading happens
 * outside any transaction: a large XML holds the event loop about half a
 * second (`received-ubl/domain/reader.ts`), which the dispatcher can afford, but
 * never with the lock held.
 */
export const downloadNext = (ctx: StepContext, fetch: FetchRecord, token: AccessToken) => Effect.gen(function*() {
  const next = yield* writing(ctx, (store) => store.next(fetch))
  if ("done" in next) return yield* writing(ctx, (store) => store.complete(fetch))
  if ("retryAt" in next) return yield* writing(ctx, (store) => store.wait(fetch, next.retryAt))
  const message = next.due
  if (!(yield* reservedCall(ctx, fetch, { operation: "descarcare", id: message.messageId }))) return
  const answer = yield* timed(ctx, ctx.gateway.download(token.access, message.messageId))
  const result = kindOf(answer, classifyDownload, { kind: "unrecognized" } as const)
  const read = result.kind === "archive" ? interpretArchive(readReceivedZip(result.archive), fetch.cif) : undefined
  yield* settled(ctx, fetch, answer, async (store, paused) => {
    if (result.kind === "archive" && read !== undefined) return store.stored(fetch, message, result.archive, read)
    if (result.kind === "rate_limited") return store.wait(fetch, paused ?? later(answer.at, RETRY_WAIT_MS))
    if (result.kind === "auth_refused") return
    const errors = result.kind === "anaf_error" ? result.errors : [Either.isLeft(answer.reply) ? answer.reply.left.reason : "raspuns_nerecunoscut"]
    return store.downloadFailed(fetch, message, errors)
  })
  if (result.kind === "auth_refused") yield* afterRefusal(ctx, fetch, token)
})
