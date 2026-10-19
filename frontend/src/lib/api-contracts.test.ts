import assert from "node:assert/strict"
import test from "node:test"

import { decodeAuthenticatedSession, decodeLoggedOutSession } from "./api-contracts.ts"

void test("decodes exact session response shapes", () => {
  assert.deepEqual(decodeAuthenticatedSession({ authenticated: true, csrfToken: "csrf", plugins: ["payments", "efactura", "company-lookup"] }),
    { authenticated: true, csrfToken: "csrf", plugins: ["payments", "efactura", "company-lookup"] })
  assert.deepEqual(decodeAuthenticatedSession({ authenticated: true, csrfToken: "csrf", plugins: [] }).plugins, [])
  decodeLoggedOutSession({ authenticated: false })
})

void test("rejects malformed session responses with the established message", () => {
  for (const value of [null, [], {}, { authenticated: true }, { authenticated: true, csrfToken: "" }, { authenticated: false, csrfToken: "x" }]) {
    assert.throws(() => decodeAuthenticatedSession(value), { message: "Forma sesiunii este invalidă." })
  }
  assert.throws(() => { decodeLoggedOutSession({ authenticated: true }) }, { message: "Forma sesiunii este invalidă." })
})

void test("a session without a valid plugin list is refused, never read as every plugin on", () => {
  for (const plugins of [undefined, null, "payments", {}, ["crm"], ["payments", 1], [null], ["company_lookup"], ["companyLookup"]]) {
    assert.throws(() => decodeAuthenticatedSession({ authenticated: true, csrfToken: "csrf", plugins }),
      { message: "Forma sesiunii este invalidă." }, JSON.stringify(plugins))
  }
})
