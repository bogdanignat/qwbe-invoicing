import assert from "node:assert/strict"
import test from "node:test"

import { decodeAuthenticatedSession, decodeLoggedOutSession } from "./api-contracts.ts"

void test("decodes exact session response shapes", () => {
  assert.deepEqual(decodeAuthenticatedSession({ authenticated: true, csrfToken: "csrf" }), { authenticated: true, csrfToken: "csrf" })
  decodeLoggedOutSession({ authenticated: false })
})

void test("rejects malformed session responses with the established message", () => {
  for (const value of [null, [], {}, { authenticated: true }, { authenticated: true, csrfToken: "" }, { authenticated: false, csrfToken: "x" }]) {
    assert.throws(() => decodeAuthenticatedSession(value), { message: "Forma sesiunii este invalidă." })
  }
  assert.throws(() => { decodeLoggedOutSession({ authenticated: true }) }, { message: "Forma sesiunii este invalidă." })
})
