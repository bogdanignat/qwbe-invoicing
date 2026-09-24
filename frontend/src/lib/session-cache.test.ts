import assert from "node:assert/strict"
import test from "node:test"

import { QueryClient, QueryObserver } from "@tanstack/react-query"

import { resetSessionCache } from "./session-cache.ts"

void test("leaving a session aborts its in-flight reads, releases their observers and keeps their answers out of the cache", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  let observed: AbortSignal | undefined
  let release: (value: string) => void = () => undefined
  const answered = new Promise<string>((resolve) => { release = resolve })

  const observer = new QueryObserver(queryClient, {
    queryKey: ["invoices"],
    queryFn: ({ signal }) => { observed = signal; return answered },
    retry: false,
  })
  const reported: Array<string> = []
  const unsubscribe = observer.subscribe((result) => { reported.push(result.fetchStatus) })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(observer.getCurrentResult().fetchStatus, "fetching")

  resetSessionCache(queryClient)
  assert.equal(observed?.aborted, true)
  // The view that was reading is told the read is over. Wiping the store alone
  // would abort the request just the same, but leave the observer reporting a
  // fetch against a query that no longer exists, so the screen the next session
  // paints would still be waiting for an answer nobody will send.
  assert.equal(observer.getCurrentResult().fetchStatus, "idle")
  assert.deepEqual(reported, ["fetching", "idle"])

  // The request that outlived the session still settles; its data belongs to the
  // session that is gone and must not land in the cache the next one will read.
  release("private-invoice-data")
  await answered
  await Promise.resolve()
  unsubscribe()
  assert.equal(queryClient.getQueryData(["invoices"]), undefined)
  assert.deepEqual(queryClient.getQueryCache().getAll(), [])
})
