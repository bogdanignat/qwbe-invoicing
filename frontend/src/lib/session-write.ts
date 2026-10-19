import { registryWriteOutcome } from "./registry-write-outcome.ts"
import { requireCsrf } from "./require-csrf.ts"

/** What a write needs from the session: the token that signs it and the epoch that owns its answer. */
export interface WriteSession {
  readonly csrfToken: () => string | undefined
  readonly epoch: () => number
  readonly ownsEpoch: (epoch: number) => boolean
}

/**
 * One write signed by the session in place, from the token to the answer.
 *
 * No token: the request never leaves, and the refusal names the fix
 * (`closedMessage`, or `requireCsrf`'s). The epoch is read before the request
 * and ownership after it (`registry-write-outcome.ts`), so an answer or a
 * rejection that outlived its session resolves to `undefined`. The value is
 * wrapped because a write may legitimately answer `undefined`.
 */
export const sessionWrite = async <Value>(
  session: WriteSession,
  run: (csrfToken: string) => Promise<Value>,
  closedMessage?: string,
): Promise<{ readonly value: Value } | undefined> => {
  const token = session.csrfToken()
  if (token === undefined && closedMessage !== undefined) throw new Error(closedMessage)
  const csrfToken = requireCsrf(token)
  const epoch = session.epoch()
  let answer: { readonly value: Value } | undefined
  const owned = await registryWriteOutcome(true, async () => { answer = { value: await run(csrfToken) } },
    () => session.ownsEpoch(epoch))
  return owned === undefined ? undefined : answer
}
