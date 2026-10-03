import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import { registryLoad, registryReload, type RegistryRead } from "./registry-load.ts"

const pending: RegistryRead = ["units", { data: undefined, isPending: true, error: null }]
const failed = (error: unknown): RegistryRead => ["vat", { data: undefined, isPending: false, error }]
const held: RegistryRead = ["customers", { data: [], isPending: false, error: null }]

void test("the screen opens only when every read it needs holds data", () => {
  assert.deepEqual(registryLoad([held, ["vat", { data: [], isPending: true, error: null }]]), { kind: "ready" })
  assert.deepEqual(registryLoad([]), { kind: "ready" })
  assert.deepEqual(registryLoad([held, pending]), { kind: "loading" })
})

void test("a failed read wins over a sibling still in flight and names what to ask again", () => {
  const boom = new Error("boom")
  assert.deepEqual(registryLoad([held, pending, failed(boom)]), {
    kind: "error", error: boom, reload: ["units", "vat"],
  })
  // A read that already answered is not refetched by the retry.
  assert.deepEqual(registryLoad([held, failed(boom)]), { kind: "error", error: boom, reload: ["vat"] })
})

void test("only a failure a repeat could answer differently offers a retry", () => {
  const asked: Array<string> = []
  const refetch = { customers: () => { asked.push("customers") }, vat: () => { asked.push("vat") } }
  const of = (error: unknown): ReturnType<typeof registryReload> =>
    registryReload(registryLoad([held, pending, failed(error)]), refetch)
  // A settled answer stays settled: no button, because repeating it repeats it.
  for (const status of [400, 401, 403, 404, 409]) {
    assert.equal(of(new ApiFailure({ message: "nu", status })), undefined, String(status))
  }
  assert.equal(of(new Error("decoder refused the payload")), undefined)
  const retry = of(new ApiFailure({ message: "offline" }))
  assert.notEqual(retry, undefined)
  retry?.()
  // Only the reads still missing are asked again, and a name with no refetcher
  // is skipped rather than thrown over.
  assert.deepEqual(asked, ["vat"])
})

void test("a screen that never failed has nothing to retry", () => {
  assert.equal(registryReload({ kind: "loading" }, {}), undefined)
  assert.equal(registryReload({ kind: "ready" }, {}), undefined)
})

void test("a thrown non-error still reaches the screen as a message", () => {
  const state = registryLoad([failed("offline")])
  assert.equal(state.kind, "error")
  assert.equal(state.error instanceof Error, true)
  assert.match(state.error.message, /\S/u)
})
