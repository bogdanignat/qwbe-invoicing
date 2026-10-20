import { Effect } from "effect"

import {
  classifyDownload, classifyStatus, nextPollAt, statusEvent, type SubmissionRecord,
} from "../../../cubes/invoicing/efactura/submissions/index.ts"
import { dispatchStore, type Due } from "../../storage/postgres-efactura-dispatch.ts"
import { takeRefreshRequest } from "../../storage/postgres-efactura-refresh-requests.ts"
import type { LeadershipLost } from "../../storage/postgres-efactura-lease.ts"
import {
  ARCHIVE_WAIT_MS, DISCONNECTED_WAIT_MS, afterRefusal, kindOf, later, reserved, settle, timed, type StepContext,
} from "./dispatch-calls.ts"
import { upload } from "./dispatch-upload.ts"
import type { AccessToken } from "./credentials.ts"

export type { StepContext } from "./dispatch-calls.ts"

/** Why a queued submission waits: the connection is now for another CIF than the one in the document. */
export const OTHER_CIF = "conexiune_alt_cif"
/** Why a queued submission waits: the organization has no usable connection. */
export const NOT_CONNECTED = "neconectat"

const poll = (ctx: StepContext, { submission, polls }: Due, uploadIndex: string, token: AccessToken) => Effect.gen(function*() {
  if ((yield* reserved(ctx, submission, { operation: "stareMesaj", id: uploadIndex }, () => Promise.resolve(true))) === undefined) return
  const answer = yield* timed(ctx, ctx.gateway.status(token.access, uploadIndex))
  const result = kindOf(answer, classifyStatus, { kind: "unrecognized" } as const)
  const done = polls + 1
  const moved = yield* settle(ctx, submission, "stareMesaj", answer, result.kind, (store, paused) => {
    if (result.kind === "accepted" || result.kind === "rejected") {
      return store.move(submission, statusEvent(result), { downloadId: result.downloadId, archiveState: "pending", polls: done,
        nextAttemptAt: answer.at.toISOString() })
    }
    const errors = result.kind === "refused" || result.kind === "anaf_error" ? result.errors : undefined
    return store.move(submission, statusEvent(result), { polls: done, errors, nextAttemptAt: paused ?? nextPollAt(answer.at, done).toISOString() })
  })
  if (result.kind === "auth_refused") yield* afterRefusal(ctx, moved, token)
})

const download = (ctx: StepContext, submission: SubmissionRecord, downloadId: string, token: AccessToken) => Effect.gen(function*() {
  if ((yield* reserved(ctx, submission, { operation: "descarcare", id: downloadId }, () => Promise.resolve(true))) === undefined) return
  const answer = yield* timed(ctx, ctx.gateway.download(token.access, downloadId))
  const result = kindOf(answer, classifyDownload, { kind: "unrecognized" } as const)
  const moved = yield* settle(ctx, submission, "descarcare", answer, result.kind, (store, paused) => result.kind === "archive"
    ? store.storeArchive(submission, result.archive)
    : store.move(submission, undefined, { nextAttemptAt: paused ?? later(answer.at, ARCHIVE_WAIT_MS) }))
  if (result.kind === "auth_refused") yield* afterRefusal(ctx, moved, token)
})

/**
 * One turn: a token refresh a request asked for, else the submission due
 * first, one step of it. `idle` when nothing is due. Every write runs in a
 * fenced transaction; no HTTP call runs inside one.
 */
export const dispatchOne = (ctx: StepContext): Effect.Effect<"idle" | "worked", LeadershipLost> => Effect.gen(function*() {
  const asked = yield* ctx.lease.run((client) => takeRefreshRequest(client, ctx.environment))
  if (asked !== undefined) {
    yield* ctx.credentials.requested(asked)
    return "worked"
  }
  const due = yield* ctx.lease.run((client) => dispatchStore(client, ctx.now()).due(ctx.environment))
  if (due === undefined) return "idle"
  const { submission } = due
  const token = yield* ctx.credentials.token(submission.organizationId)
  // Not connected, or connected for another CIF: no ANAF call at all, the submission waits as it is.
  if (token === undefined || token.verifiedCif !== submission.cif) {
    const errors = submission.state !== "queued" ? undefined : token === undefined ? [NOT_CONNECTED] : [OTHER_CIF]
    yield* ctx.lease.run((client) => dispatchStore(client, ctx.now()).move(submission, undefined, {
      nextAttemptAt: later(ctx.now(), DISCONNECTED_WAIT_MS), errors }))
  } else if (submission.state === "queued") yield* upload(ctx, submission, token)
  else if (submission.state === "processing" && submission.uploadIndex !== null) yield* poll(ctx, due, submission.uploadIndex, token)
  else if (submission.downloadId !== null) yield* download(ctx, submission, submission.downloadId, token)
  return "worked"
})
