import assert from "node:assert/strict"
import test from "node:test"

import { draftRemovalFeedback } from "./draft-removal-feedback.ts"

void test("a deletion refused because one is already running reads as still pending, not as silence", () => {
  const feedback = draftRemovalFeedback({ kind: "busy" }, null, false)
  assert.equal(feedback.pending, true)
  assert.equal(feedback.error, null)
})

void test("a deletion whose session ended raises nothing: the error would be about work nobody awaits", () => {
  const feedback = draftRemovalFeedback({ kind: "aborted" }, null, false)
  assert.equal(feedback.error, null)
  assert.equal(feedback.pending, false)
})

void test("an unconfirmed deletion reaches the screen as its own message", () => {
  const feedback = draftRemovalFeedback({ kind: "unconfirmed", message: "Nu este confirmat." }, null, false)
  assert.equal((feedback.error as Error).message, "Nu este confirmat.")
})

void test("a failed deletion surfaces the failure, and a throw the controller never caught surfaces too", () => {
  const failure = new Error("a eșuat")
  assert.equal(draftRemovalFeedback({ kind: "error", error: failure }, null, false).error, failure)
  const thrown = new Error("CSRF lipsă")
  assert.equal(draftRemovalFeedback(undefined, thrown, false).error, thrown)
})

void test("a successful deletion leaves no error behind", () => {
  assert.equal(draftRemovalFeedback({ kind: "saved" }, null, false).error, null)
})
