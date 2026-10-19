import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import test from "node:test"

import { startServer } from "./http.ts"
import { withMigrated } from "../storage/postgres-rig.test-support.ts"

/**
 * Every spelling of the login route that the real API router accepts is either
 * refused at the edge or throttled as a login. Measured against the real Effect
 * router on a real database: the throttle keys on what the router will match,
 * not on the string the client chose.
 */
const token = "alias-throttle-secret-".repeat(3)

void test("spellings of POST /api/session are refused or throttled exactly like the login", async () => {
  await withMigrated("http_login_alias", async (fixture) => {
    const tokenFile = join(fixture.dataDirectory, "api-token")
    writeFileSync(tokenFile, token, { mode: 0o600 })
    // A frozen clock: the cooldown cannot run out between the assertions.
    const frozen = () => 1_800_000_000_000
    const running = await startServer(fixture.config({ port: 0, authTokenFile: tokenFile }), fixture.pool, () => Promise.resolve(true),
      undefined, { now: frozen, monotonicNow: frozen })
    try {
      const origin = `http://127.0.0.1:${String((running.server.address() as AddressInfo).port)}`
      const login = async (path: string, supplied: string): Promise<number> => {
        const response = await fetch(`${origin}${path}`, { method: "POST",
          headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token: supplied }) })
        await response.arrayBuffer()
        return response.status
      }
      for (const path of ["/api/%73ession", "/api/%73%65ssion", "/api/session;x", "/api/session;jsessionid=1"]) {
        assert.equal(await login(path, "wrong"), 400, `${path} must be refused at the edge`)
      }
      // The router matches these case-insensitively and without the trailing
      // slash: each wrong token counts as a failed login.
      const variants = ["/api/session/", "/api/Session", "/api/SESSION", "/api/Session/", "/api/session", "/api/sEssion"]
      for (const path of variants) assert.equal(await login(path, "wrong"), 401, path)
      // The sixth failure started the cooldown: every spelling is throttled now,
      // the right token included.
      for (const path of variants) assert.equal(await login(path, token), 429, path)
      // `/API/...` is not an API path for the kernel and never reaches the API
      // router: the kernel's own route table answers it (405 for a POST).
      assert.equal(await login("/API/session", token), 405)
    } finally {
      await running.close()
    }
  })
})
