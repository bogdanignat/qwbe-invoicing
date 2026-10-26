/**
 * How long a browser session lives: 12 hours after its last authenticated
 * request (sliding), and never more than 30 days after login, however busy it
 * is. The absolute cap bounds a stolen cookie that is kept warm.
 *
 * `expires_at` is the only state: the last extension is `expires_at` minus the
 * idle window, so no `last_seen_at` column is needed. A request extends the row
 * only once the window has moved by `extensionStepMs`, so a busy session costs
 * at most one write every five minutes, not one per request.
 */
const minute = 60_000
export const idleTimeoutMs = 12 * 60 * minute
export const absoluteLifetimeMs = 30 * 24 * 60 * minute
export const extensionStepMs = 5 * minute

export const initialExpiry = (createdAt: number): number => createdAt + idleTimeoutMs

/** The expiry a request at `now` earns, or `undefined` when the row does not need a write yet. */
export const extendedExpiry = (
  session: { readonly createdAt: number; readonly expiresAt: number },
  now: number,
): number | undefined => {
  const expiresAt = Math.min(now + idleTimeoutMs, session.createdAt + absoluteLifetimeMs)
  return expiresAt - session.expiresAt >= extensionStepMs ? expiresAt : undefined
}
