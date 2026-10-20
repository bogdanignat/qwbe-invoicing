import { Effect } from "effect"

import { classifyList, type ListedMessage, type ListResult, type SubmissionRecord } from "../../submissions/index.ts"
import { MAX_LINK_PAGES, isOwnUpload, listOutcome, listWindow } from "../domain/listing.ts"
import { conflict } from "./lookup.ts"
import type { ListCall, ReconciliationAnaf, ReconciliationDependencies, RequestToken } from "./ports.ts"

export interface ListedPage {
  readonly messages: ReadonlyArray<ListedMessage>
  readonly pages: number
}

/** What a request may call ANAF with, for one `unknown` submission. */
export interface Reachable {
  readonly submission: SubmissionRecord
  readonly anaf: ReconciliationAnaf
  readonly token: RequestToken
}

const resultOf = (call: ListCall): ListResult => typeof call.reply === "string" ? { kind: "unrecognized" } : classifyList(call.reply)

/** The stored pair: configured, connected, and for the submission's CIF. A request never refreshes it. */
export const reachable = (dependencies: ReconciliationDependencies, submission: SubmissionRecord) => Effect.gen(function*() {
  const { anaf } = dependencies
  if (anaf === undefined) return yield* conflict("efactura_not_configured", "ANAF e-Factura is not configured")
  const token = yield* anaf.token(submission.organizationId)
  if (token === undefined) return yield* conflict("efactura_not_connected", "connect to ANAF e-Factura first")
  if (token.verifiedCif !== submission.cif) {
    return yield* conflict("efactura_cif_mismatch", "the ANAF connection is verified for another CIF than this submission's")
  }
  return { submission, anaf, token } satisfies Reachable
})

/**
 * One page of ANAF's list for the submission's CIF and window. The call is
 * reserved in the organization's budget before it leaves and logged after; a
 * 429 pauses the organization. A 401/403 asks the dispatcher to refresh this
 * pair and answers that the connection is being refreshed: a request never
 * refreshes a token itself.
 */
export const listPage = (dependencies: ReconciliationDependencies, { anaf, submission, token }: Reachable, page: number) =>
  Effect.gen(function*() {
    const { clock, store } = dependencies
    const { organizationId } = submission
    const now = yield* clock.now
    const waitUntil = yield* store.transaction((transaction) => transaction.reserveCall(organizationId, now))
    if (waitUntil !== undefined) return yield* conflict("efactura_rate_limited", `ANAF's call budget is spent until ${waitUntil}`)
    const call = yield* anaf.list(token.access, { cif: submission.cif, ...listWindow(submission.createdAt, now), page })
    const result = resultOf(call)
    const reply = typeof call.reply === "string" ? undefined : call.reply
    yield* store.transaction((transaction) => Effect.gen(function*() {
      yield* transaction.logCall(submission, { outcome: listOutcome(call.reply, result), httpStatus: reply?.status,
        durationMs: call.durationMs, startedAt: call.startedAt })
      if (result.kind === "rate_limited") yield* transaction.pause(organizationId, reply?.retryAfter ?? null, now)
      if (result.kind === "auth_refused") yield* transaction.requestRefresh(organizationId, token)
    }))
    switch (result.kind) {
      case "messages": return { messages: result.messages, pages: result.pages } satisfies ListedPage
      case "auth_refused": return yield* conflict("efactura_connection_refreshing", "the ANAF connection is being refreshed; try again shortly")
      case "rate_limited": return yield* conflict("efactura_rate_limited", "ANAF asked to slow down; try again shortly")
      case "no_right": return yield* conflict("efactura_no_right", "ANAF says the connection has no right on this CIF")
      default: return yield* conflict("efactura_anaf_unavailable", "ANAF did not answer the list clearly; try again later")
    }
  })

/** Whether ANAF lists `uploadIndex` as an upload of this CIF in the window, looked for page by page, at most `MAX_LINK_PAGES`. */
export const listedByAnaf = (dependencies: ReconciliationDependencies, target: Reachable, uploadIndex: string) => Effect.gen(function*() {
  for (let page = 1; page <= MAX_LINK_PAGES; page += 1) {
    const listed = yield* listPage(dependencies, target, page)
    if (listed.messages.some((message) => message.uploadIndex === uploadIndex && isOwnUpload(message))) return true
    if (page >= listed.pages) return false
  }
  return false
})
