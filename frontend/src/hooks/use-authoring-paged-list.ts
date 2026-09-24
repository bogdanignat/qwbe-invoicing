import { useInfiniteQuery, type InfiniteData, type UseInfiniteQueryResult } from "@tanstack/react-query"

import { useAuth } from "./auth-context.ts"
import { isTransientFailure } from "../lib/api-errors.ts"
import type { Page, PageRequest } from "../lib/model-decoder.ts"

export interface AuthoringPagedList<Item> {
  readonly items: ReadonlyArray<Item> | undefined
  readonly isPending: boolean
  readonly error: unknown
  readonly retry: (() => void) | undefined
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  readonly refetch: () => void
}

const pagedModel = <Item>(query: UseInfiniteQueryResult<InfiniteData<Page<Item>>>): AuthoringPagedList<Item> => ({
  items: query.data?.pages.flatMap((page) => page.items),
  isPending: query.isPending,
  error: query.error,
  retry: isTransientFailure(query.error)
    ? (query.isFetchNextPageError
      ? () => { void query.fetchNextPage() }
      : () => { void query.refetch() })
    : undefined,
  hasMore: query.hasNextPage,
  loadingMore: query.isFetchingNextPage,
  loadMore: () => { void query.fetchNextPage() },
  refetch: () => { void query.refetch() },
})

/**
 * One cursor-paged registry, one page per fetch, for the authenticated shell
 * only. The registries an authoring screen reads are larger than any single
 * answer: the server caps a page, the cursor walks it, and the screen offers
 * "load more" rather than truncating silently.
 */
export const useAuthoringPagedList = <Item>(
  queryKey: ReadonlyArray<string>,
  list: (page: PageRequest | undefined, signal: AbortSignal) => Promise<Page<Item>>,
): AuthoringPagedList<Item> => {
  const { status } = useAuth()
  return pagedModel<Item>(useInfiniteQuery({
    queryKey,
    enabled: status === "authenticated",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      list(pageParam === undefined ? undefined : { cursor: pageParam }, signal),
    getNextPageParam: (last: Page<Item>) => last.nextCursor ?? undefined,
  }))
}
