import type { QueryClient } from "@tanstack/react-query"

/**
 * Drops every cached answer that belonged to the session being left.
 *
 * Emptying the store is already enough to stop the reads themselves: `clear()`
 * destroys every query, and destroying one aborts the request running under it
 * through the signal `useQuery` passed to the transport, then discards a late
 * answer instead of writing it back. What it does not do is tell the views. An
 * observer that was reading stays on a query that no longer exists and keeps
 * reporting `fetchStatus: "fetching"` for a request nobody will ever answer.
 * Cancelling first reverts those observers to `idle`, so the session being
 * entered starts from views that are not stuck mid-request.
 */
export const resetSessionCache = (queryClient: QueryClient): void => {
  void queryClient.cancelQueries()
  queryClient.clear()
}
