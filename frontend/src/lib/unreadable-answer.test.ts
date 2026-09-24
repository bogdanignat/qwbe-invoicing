import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import { readableWrite, UnreadableAnswer } from "./unreadable-answer.ts"

/**
 * The classification that decides whether a second invoice can exist: an answer
 * that arrived but could not be read is not a failure, and a failure that never
 * reached the server is not an unreadable answer.
 */

const rejected = async (answer: Promise<unknown>): Promise<unknown> => {
  try {
    await answer
  } catch (error) {
    return error
  }
  throw new Error("the write was expected to reject")
}

void test("an answer that reads is handed back untouched", async () => {
  assert.deepEqual(await readableWrite(Promise.resolve({ id: "draft-1" })), { id: "draft-1" })
})

void test("a 2xx whose body is not JSON is unreadable, not settled", async () => {
  const cause = new ApiFailure({ message: "răspuns invalid", status: 200 })
  const error = await rejected(readableWrite(Promise.reject(cause)))
  assert.ok(error instanceof UnreadableAnswer)
  assert.equal(error.cause, cause)
  assert.ok(error.message.includes("verifica registrul") || error.message.includes("verifici registrul"))
})

void test("a 2xx whose shape drifted from the contract is unreadable too", async () => {
  const cause = new Error("expected string at lines.0.description")
  const error = await rejected(readableWrite(Promise.reject(cause)))
  assert.ok(error instanceof UnreadableAnswer)
  assert.equal(error.cause, cause)
})

void test("a refusal the server stated stays the refusal it is", async () => {
  const cause = new ApiFailure({ message: "conflict", status: 409, code: "idempotency_key_reused" })
  const error = await rejected(readableWrite(Promise.reject(cause)))
  assert.equal(error, cause)
})

void test("a transport failure with no status is left to the lost-answer classification", async () => {
  const cause = new ApiFailure({ message: "network" })
  assert.equal(await rejected(readableWrite(Promise.reject(cause))), cause)
})

void test("an abort is the caller's own doing and keeps its identity", async () => {
  const cause = new Error("aborted")
  cause.name = "AbortError"
  assert.equal(await rejected(readableWrite(Promise.reject(cause))), cause)
})

void test("an unreadable answer is never wrapped twice", async () => {
  const cause = new UnreadableAnswer(new Error("inner"))
  assert.equal(await rejected(readableWrite(Promise.reject(cause))), cause)
})
