import assert from "node:assert/strict"
import test from "node:test"

import { evictDraftAfterNavigation, exactDraftQuery } from "./query-cache.ts"

void test("schedules exact draft cache eviction after navigation", () => {
  const events: Array<string> = ["navigated"]
  let scheduled: (() => void) | undefined
  let removed: unknown
  evictDraftAfterNavigation("draft/1", (filter) => { events.push("removed"); removed = filter }, (callback) => { scheduled = callback })
  assert.deepEqual(events, ["navigated"])
  assert.deepEqual(exactDraftQuery("draft/1"), { queryKey: ["draft", "draft/1"], exact: true })
  assert.ok(scheduled)
  scheduled()
  assert.deepEqual(events, ["navigated", "removed"])
  assert.deepEqual(removed, { queryKey: ["draft", "draft/1"], exact: true })
})
