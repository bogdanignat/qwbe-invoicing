import { Effect } from "effect"

import { FETCH_FAILURES, MAX_LIST_RETRIES, fetchWindow, isReceivedInvoice, listable } from "../../../cubes/invoicing/efactura/received/index.ts"
import { classifyList } from "../../../cubes/invoicing/efactura/submissions/index.ts"
import type { DueFetch } from "../../storage/postgres-efactura-received-dispatch.ts"
import type { LeadershipLost } from "../../storage/postgres-efactura-lease.ts"
import { RETRY_WAIT_MS, kindOf, later, timed, type StepContext } from "./dispatch-calls.ts"
import type { AccessToken } from "./credentials.ts"
import { afterRefusal, reservedCall, settled, writing } from "./received-calls.ts"
import { downloadNext } from "./received-download.ts"

/**
 * One page of the fetch's window, `filtru=P`, kept to `FACTURA PRIMITA`.
 * Until its first page is listed, a fetch has asked ANAF nothing: however long
 * it waited behind submissions, pauses and retries, its window is taken again
 * from now and the coverage, and kept with that page. Only a window already
 * half listed can fall out of ANAF's 60 days; the fetch then fails instead of
 * asking. ANAF's own error (the 60-day refusal among them) or a missing right
 * fails the fetch; an answer that says nothing clear is asked again, a few times.
 */
const listNext = (ctx: StepContext, { fetch, retries, coveredUntil }: DueFetch, token: AccessToken) => Effect.gen(function*() {
  const window = fetch.pagesListed === 0 ? fetchWindow(ctx.now(), coveredUntil) : fetch.window
  if (!listable(window.start, ctx.now())) return yield* writing(ctx, (store) => store.fail(fetch, [FETCH_FAILURES.windowExpired]))
  if (!(yield* reservedCall(ctx, fetch))) return
  const page = fetch.pagesListed + 1
  const answer = yield* timed(ctx, ctx.gateway.list(token.access, {
    cif: fetch.cif, startTime: Date.parse(window.start), endTime: Date.parse(window.end), page, filter: "P" }))
  const result = kindOf(answer, classifyList, { kind: "unrecognized" } as const)
  yield* settled(ctx, fetch, answer, async (store, paused) => {
    switch (result.kind) {
      case "messages": return store.listed(fetch, window, page, result.pages, result.messages.filter(isReceivedInvoice))
      case "rate_limited": return store.wait(fetch, paused ?? later(answer.at, RETRY_WAIT_MS))
      case "auth_refused": return
      case "no_right": return store.fail(fetch, [FETCH_FAILURES.noRight])
      case "anaf_error": return store.fail(fetch, result.errors)
      default: return retries >= MAX_LIST_RETRIES ? store.fail(fetch, [FETCH_FAILURES.anafUnavailable])
        : store.retryList(fetch, retries + 1, later(answer.at, RETRY_WAIT_MS))
    }
  })
  if (result.kind === "auth_refused") yield* afterRefusal(ctx, fetch, token)
})

/**
 * One step of the received-invoice fetch due first, when no submission is
 * due: a page to list, or a message to download. Only fetches a user asked
 * for exist; nothing here starts one. A fetch whose organization is no longer
 * connected for its CIF fails without calling ANAF. Each step is one call and
 * its write, so a crash or a lost lead only repeats the call in flight: the
 * new leader picks the fetch up where its last write left it, and the
 * dispatcher's recovery has nothing to undo.
 */
export const fetchOne = (ctx: StepContext): Effect.Effect<"idle" | "worked", LeadershipLost> => Effect.gen(function*() {
  const due = yield* writing(ctx, (store) => store.due(ctx.environment))
  if (due === undefined) return "idle"
  const { fetch } = due
  const token = yield* ctx.credentials.token(fetch.organizationId)
  if (token === undefined || token.verifiedCif !== fetch.cif) {
    const reason = token === undefined ? FETCH_FAILURES.notConnected : FETCH_FAILURES.otherCif
    yield* writing(ctx, (store) => store.fail(fetch, [reason]))
  } else if (fetch.state === "listing") yield* listNext(ctx, due, token)
  else yield* downloadNext(ctx, fetch, token)
  return "worked"
})
