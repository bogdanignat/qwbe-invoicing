import { useInfiniteQuery } from "@tanstack/react-query"
import type { Effect } from "effect"

import { runUiEffect, type ApiFailure } from "./api.ts"
import type { Page, PageRequest } from "./models.ts"

// One registry page per fetch; "Încarcă mai multe" follows nextCursor until the server returns null.
export const usePagedList = <Item>(queryKey: ReadonlyArray<string>, list: (page?: PageRequest) => Effect.Effect<Page<Item>, ApiFailure>) => {
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => runUiEffect(list(pageParam === undefined ? undefined : { cursor: pageParam }), signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const items = query.data?.pages.flatMap((page) => page.items)
  return {
    items, error: query.error, isPending: query.isPending,
    hasMore: query.hasNextPage, loadingMore: query.isFetchingNextPage,
    loadMore: () => { void query.fetchNextPage() },
  }
}

export type PagedList<Item> = ReturnType<typeof usePagedList<Item>>
