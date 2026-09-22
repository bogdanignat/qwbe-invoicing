import assert from "node:assert/strict"
import test from "node:test"
import { QueryClient } from "@tanstack/react-query"

import {
  evictDraftAfterNavigation, exactDraftQuery, invalidateInvoiceAfterCorrection,
  invalidateInvoiceRegister,
} from "./query-cache.ts"

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

void test("invalidates the invoice register with a real QueryClient", async () => {
  const client = new QueryClient()
  try {
    client.setQueryData(["invoice-register"], { items: [] })
    client.setQueryData(["invoice", "invoice-1"], { id: "invoice-1" })
    await invalidateInvoiceRegister(client)
    assert.equal(client.getQueryState(["invoice-register"])?.isInvalidated, true)
    assert.equal(client.getQueryState(["invoice", "invoice-1"])?.isInvalidated, false)
  } finally {
    client.clear()
  }
})

void test("invalidates invoice detail and register after a successful correction", async () => {
  const client = new QueryClient()
  try {
    client.setQueryData(["invoice-register"], { items: [] })
    client.setQueryData(["invoice", "invoice-1"], { id: "invoice-1" })
    await invalidateInvoiceAfterCorrection(client, "invoice-1")
    assert.equal(client.getQueryState(["invoice-register"])?.isInvalidated, true)
    assert.equal(client.getQueryState(["invoice", "invoice-1"])?.isInvalidated, true)
  } finally {
    client.clear()
  }
})
