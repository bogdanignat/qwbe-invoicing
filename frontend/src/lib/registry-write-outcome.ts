/**
 * Whether the answer to a write still belongs to the session that asked.
 *
 * A master-data write is not replayable and does not need to be, but its answer
 * can still land after the session it was sent from ended — a logout, a `401`
 * that re-locked the screen, another token unlocked in the same tab. Whatever
 * comes back then belongs to nobody: the notice would name a write the current
 * session never made, the invalidation would refetch on its behalf, and a
 * rejection would put the previous session's error in front of it.
 *
 * So both ends are filtered, not only the successful one: an answer the session
 * no longer owns resolves to `undefined` and leaves the screen exactly as it
 * was. `owns` is read *after* the request settles, because that is when the
 * question is asked — the session may have changed while it was in flight.
 */
export const registryWriteOutcome = async <Request>(
  request: Request,
  run: () => Promise<unknown>,
  owns: () => boolean,
): Promise<Request | undefined> => {
  try {
    await run()
  } catch (cause) {
    if (!owns()) return undefined
    throw cause
  }
  return owns() ? request : undefined
}
