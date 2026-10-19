import assert from "node:assert/strict"
import test from "node:test"

import { cookieValue, sessionCookieValues } from "./browser-session-helpers.ts"

const id = "a".repeat(43)

void test("a session id is read only from exactly one non-empty qwbe_session cookie", () => {
  assert.equal(cookieValue(`qwbe_session=${id}`), id)
  assert.equal(cookieValue(`other=1; qwbe_session=${id}; theme=dark`), id)
  // An empty cookie before a valid one used to be skipped, so the second won.
  for (const header of [undefined, "", "qwbe_session=", "qwbe_session", `qwbe_session=; qwbe_session=${id}`,
    `qwbe_session=${id}; qwbe_session=${id}`, `qwbe_session=${id}, qwbe_session=${"b".repeat(43)}`]) {
    assert.equal(cookieValue(header), undefined, String(header))
  }
})

void test("every qwbe_session value is listed, empty ones included, and foreign names are ignored", () => {
  assert.deepEqual(sessionCookieValues(`qwbe_session=; x=1, qwbe_session = ${id}; QWBE_SESSION=y`), ["", id])
  assert.deepEqual(sessionCookieValues("qwbe_sessionx=1; xqwbe_session=2"), [])
})
