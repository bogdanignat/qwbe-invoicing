import type { SaveOutcome } from "./draft-save-types.ts"

/**
 * What a deletion outcome means on the list screen.
 *
 * Every branch has to land somewhere the user can see, except the one that
 * deliberately must not: `aborted` is a session that ended under the request —
 * a logout, an unmounted screen — and an error banner about it would be noise
 * about work nobody is waiting for any more. `busy` is not a failure either:
 * another deletion is still running, so the honest reading is "still pending",
 * not silence on a second click.
 */
export interface RemovalFeedback {
  readonly pending: boolean
  readonly error: unknown
}

export const draftRemovalFeedback = (
  outcome: SaveOutcome | undefined,
  mutationError: unknown,
  mutationPending: boolean,
): RemovalFeedback => {
  if (outcome === undefined) return { pending: mutationPending, error: mutationError ?? null }
  if (outcome.kind === "busy") return { pending: true, error: mutationError ?? null }
  if (outcome.kind === "aborted") return { pending: mutationPending, error: null }
  if (outcome.kind === "error") return { pending: mutationPending, error: outcome.error }
  if (outcome.kind === "unconfirmed") return { pending: mutationPending, error: new Error(outcome.message) }
  return { pending: mutationPending, error: mutationError ?? null }
}
