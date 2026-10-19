import { Effect } from "effect"

import {
  UPLOAD_EVENTS, classifyUpload, classifyValidation, nextPollAt, validationEvent, type SubmissionRecord,
} from "../../../cubes/invoicing/efactura/submissions/index.ts"
import type { Patch } from "../../storage/postgres-efactura-dispatch.ts"
import { RETRY_WAIT_MS, afterRefusal, kindOf, later, reserved, settle, timed, type StepContext } from "./dispatch-calls.ts"
import type { AccessToken } from "./credentials.ts"

/**
 * A queued submission: `validare`, then `uploading` committed, then the one
 * upload and ANAF's answer to it. Starting clears the reason it waited for.
 */
export const upload = (ctx: StepContext, submission: SubmissionRecord, token: AccessToken) => Effect.gen(function*() {
  const claimed = yield* reserved(ctx, submission, undefined, async (store) => ({
    xml: await store.xml(submission.id), validating: await store.move(submission, "validation_started", { errors: [] }) }))
  if (claimed === undefined) return
  const { xml, validating } = claimed.value
  const checked = yield* timed(ctx, ctx.gateway.validate(token.access, submission.standard, xml))
  const verdict = kindOf(checked, classifyValidation, { kind: "unrecognized" } as const)
  const uploading = yield* settle(ctx, validating, "validare", checked, verdict.kind, async (store, paused) => {
    if (verdict.kind === "invalid") return void await store.move(validating, "validation_failed", { errors: verdict.errors })
    const waitUntil = validationEvent(verdict) === "validation_passed" ? await store.reserve(submission.organizationId) : paused ?? later(checked.at, RETRY_WAIT_MS)
    if (waitUntil !== undefined) return void await store.move(validating, "validation_retry", { nextAttemptAt: waitUntil })
    return store.move(validating, "validation_passed")
  })
  if (verdict.kind === "auth_refused") yield* afterRefusal(ctx, { ...validating, state: "queued" }, token)
  if (uploading === undefined) return
  // `uploading` is committed: from here on, nothing but ANAF's own answer sends it anywhere but `unknown`.
  const sent = yield* timed(ctx, ctx.gateway.upload(token.access, submission.standard, submission.cif, xml))
  const result = kindOf(sent, classifyUpload, { kind: "ambiguous" } as const)
  const patch: Patch = result.kind === "indexed" ? { uploadIndex: result.uploadIndex, polls: 0, nextAttemptAt: nextPollAt(sent.at, 0).toISOString() }
    : result.kind === "refused" ? { errors: result.errors } : result.kind === "auth_refused" ? { nextAttemptAt: later(sent.at, RETRY_WAIT_MS) } : {}
  const moved = yield* settle(ctx, uploading, "upload", sent, result.kind, (store) => store.move(uploading, UPLOAD_EVENTS[result.kind], patch))
  if (result.kind === "auth_refused") yield* afterRefusal(ctx, moved, token)
})
