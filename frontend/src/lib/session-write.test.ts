import assert from "node:assert/strict"
import test from "node:test"

import { sessionWrite, type WriteSession } from "./session-write.ts"

const session = (token: string | undefined, owns: () => boolean = () => true): WriteSession =>
  ({ csrfToken: () => token, epoch: () => 7, ownsEpoch: (epoch) => epoch === 7 && owns() })

void test("the write is signed with the session's token and its answer handed back", async () => {
  const signed: Array<string> = []
  const answer = await sessionWrite(session("csrf-1"), (token) => { signed.push(token); return Promise.resolve("saved") })
  assert.deepEqual([answer, signed], [{ value: "saved" }, ["csrf-1"]])
  assert.deepEqual(await sessionWrite(session("csrf-1"), () => Promise.resolve(undefined)), { value: undefined })
})

void test("without a token nothing leaves, with the caller's message or requireCsrf's", async () => {
  let sent = false
  const run = () => { sent = true; return Promise.resolve() }
  await assert.rejects(sessionWrite(session(undefined), run, "Sesiune închisă."), { message: "Sesiune închisă." })
  await assert.rejects(sessionWrite(session(undefined), run), { message: /nu mai poate semna/u })
  assert.equal(sent, false)
})

void test("an answer or a rejection that outlived its session leaves nothing behind", async () => {
  let held = true
  const lost = session("csrf-1", () => held)
  assert.equal(await sessionWrite(lost, () => { held = false; return Promise.resolve("late") }), undefined)
  held = true
  assert.equal(await sessionWrite(lost, () => { held = false; return Promise.reject(new Error("401")) }), undefined)
  const boom = new Error("409")
  await assert.rejects(sessionWrite(session("csrf-1"), () => Promise.reject(boom)), (error: unknown) => error === boom)
})
