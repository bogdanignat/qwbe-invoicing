import assert from "node:assert/strict"
import test from "node:test"

import { registryWriteOutcome } from "./registry-write-outcome.ts"

const request = { write: "created" } as const
const owned = (): boolean => true
const lost = (): boolean => false

void test("an answer the session still owns is handed back for its notice", async () => {
  assert.equal(await registryWriteOutcome(request, () => Promise.resolve({ id: "c1" }), owned), request)
})

void test("an answer that outlived its session leaves nothing behind", async () => {
  assert.equal(await registryWriteOutcome(request, () => Promise.resolve({ id: "c1" }), lost), undefined)
})

void test("a rejection the session still owns is the error the screen shows", async () => {
  const boom = new Error("409")
  await assert.rejects(
    registryWriteOutcome(request, () => Promise.reject(boom), owned),
    (error: unknown) => error === boom,
  )
})

// The session that would read this error is not the one that made the request:
// a late `401` re-locks the screen, and the refusal belongs to the token that
// is gone, not to the one unlocked after it.
void test("a rejection that outlived its session is not shown to the next one", async () => {
  assert.equal(
    await registryWriteOutcome(request, () => Promise.reject(new Error("401")), lost),
    undefined,
  )
})

void test("ownership is read after the request settles, not before", async () => {
  let epochHeld = true
  const outcome = await registryWriteOutcome(request, () => {
    epochHeld = false
    return Promise.resolve(undefined)
  }, () => epochHeld)
  assert.equal(outcome, undefined)
})
