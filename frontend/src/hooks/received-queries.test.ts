import assert from "node:assert/strict"
import test from "node:test"

import { environmentManager, InfiniteQueryObserver, QueryClient, QueryObserver } from "@tanstack/react-query"

import { receivedListQuery, receivedStatusQuery } from "./received-queries.ts"
import { createBrowserTransport } from "../lib/browser-transport.ts"
import { createEFacturaReceivedClient, receivedQueryKeys } from "../lib/efactura-received-client.ts"

const fetchOf = (state: string) => ({
  id: "f-1", environment: "test", cif: "12345674", window: { start: "2026-09-01T09:00:00.000Z", end: "2026-10-23T09:00:00.000Z" },
  state, pagesListed: 0, pagesTotal: 0, found: 0, queued: 0, downloaded: 0, failed: 0, errors: [],
  createdBy: "owner", createdAt: "2026-10-23T09:00:00.000Z", updatedAt: "2026-10-23T09:00:00.000Z",
})

/** A transport answering each path from `answers`, in turn, counting what was asked. */
const scripted = (answers: Readonly<Record<string, ReadonlyArray<unknown>>>) => {
  const requested: Array<string> = []
  const transport = createBrowserTransport({
    fetch: (input) => {
      const path = typeof input === "string" ? input : "not-a-path"
      requested.push(path)
      const queue = answers[path] ?? []
      const answer = queue[Math.min(requested.filter((asked) => asked === path).length - 1, queue.length - 1)]
      return Promise.resolve(Response.json(answer ?? {}))
    },
    onUnauthorized: () => undefined,
  })
  return { client: createEFacturaReceivedClient(transport), requested }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))
const queryClientOf = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

void test("the status is polled while the fetch is active and not after", () => {
  const { client } = scripted({})
  const queryClient = queryClientOf()
  const options = receivedStatusQuery(client, queryClient, true)
  assert.ok(typeof options.refetchInterval === "function")
  const intervalFor = (state: string) => {
    queryClient.setQueryData(receivedQueryKeys.status, { fetch: { ...fetchOf(state), gap: undefined }, coveredUntil: null })
    const query = queryClient.getQueryCache().find({ queryKey: receivedQueryKeys.status })
    return typeof options.refetchInterval === "function" ? options.refetchInterval(query as never) : undefined
  }
  assert.deepEqual(["listing", "downloading", "completed", "failed"].map(intervalFor), [3000, 3000, false, false])
})

/** Node has no `window`, so the query core sets no timer: this case runs as a browser. */
void test("a fetch put in the status, as „Preia din SPV” does, turns polling on: false becomes 3000", async () => {
  const STATUS = "/api/efactura/received/status"
  const { client, requested } = scripted({ [STATUS]: [{ fetch: fetchOf("completed"), coveredUntil: null }] })
  const queryClient = queryClientOf()
  const options = receivedStatusQuery(client, queryClient, true)
  const server = environmentManager.isServer()
  environmentManager.setIsServer(() => false)
  const stop = new QueryObserver(queryClient, options).subscribe(() => undefined)
  try {
    await settle()
    const query = queryClient.getQueryCache().find({ queryKey: receivedQueryKeys.status })
    const interval = () => typeof options.refetchInterval === "function" ? options.refetchInterval(query as never) : undefined
    assert.equal(interval(), false)
    queryClient.setQueryData(receivedQueryKeys.status, { fetch: { ...fetchOf("listing"), gap: undefined }, coveredUntil: null })
    assert.equal(interval(), 3000)
    await new Promise((resolve) => setTimeout(resolve, 3_200))
    assert.deepEqual(requested, [STATUS, STATUS], "one read on mount, one poll after the fetch was put in")
  } finally {
    stop()
    environmentManager.setIsServer(() => server)
  }
})

void test("the answer in which the active fetch is over invalidates the list; one still running does not", async () => {
  const { client } = scripted({
    "/api/efactura/received/status": [
      { fetch: fetchOf("downloading"), coveredUntil: null },
      { fetch: fetchOf("downloading"), coveredUntil: null },
      { fetch: fetchOf("completed"), coveredUntil: "2026-10-23T09:00:00.000Z" },
    ],
  })
  const queryClient = queryClientOf()
  queryClient.setQueryData(receivedQueryKeys.list, { pages: [], pageParams: [] })
  const listStale = () => queryClient.getQueryState(receivedQueryKeys.list)?.isInvalidated
  const options = receivedStatusQuery(client, queryClient, true)
  await queryClient.query(options)
  assert.equal(listStale(), false, "the first read of the page")
  await queryClient.query(options)
  assert.equal(listStale(), false, "still downloading")
  await queryClient.query(options)
  assert.equal(listStale(), true)
})

void test("with the plugin off neither the status nor the list is asked", async () => {
  const { client, requested } = scripted({})
  const queryClient = queryClientOf()
  const stops = [
    new QueryObserver(queryClient, receivedStatusQuery(client, queryClient, false)).subscribe(() => undefined),
    new InfiniteQueryObserver(queryClient, receivedListQuery(client, false)).subscribe(() => undefined),
  ]
  await settle()
  for (const stop of stops) stop()
  assert.deepEqual(requested, [])
})

void test("the list follows the cursor: „Încarcă mai multe” asks for the next page", async () => {
  const { client, requested } = scripted({
    "/api/efactura/received": [{ items: [], nextCursor: "c1" }],
    "/api/efactura/received?cursor=c1": [{ items: [], nextCursor: null }],
  })
  const queryClient = queryClientOf()
  const observer = new InfiniteQueryObserver(queryClient, receivedListQuery(client, true))
  const stop = observer.subscribe(() => undefined)
  await settle()
  assert.equal(observer.getCurrentResult().hasNextPage, true)
  await observer.fetchNextPage()
  stop()
  assert.deepEqual(requested, ["/api/efactura/received", "/api/efactura/received?cursor=c1"])
  assert.equal(observer.getCurrentResult().hasNextPage, false)
})
