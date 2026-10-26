import assert from "node:assert/strict"
import { once } from "node:events"
import { writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import test from "node:test"

import { apiDocsResponse } from "./api-docs.ts"
import { startServer } from "./http.ts"
import { allPlugins } from "../plugins.ts"
import { withMigrated } from "../storage/postgres-rig.test-support.ts"

/**
 * The sessions group over HTTP, on the injected clock: a logout refused on CSRF
 * or Origin leaves `expires_at` where it was, a `GET /api/session` extends it.
 */
void test("a refused logout does not extend the session, a resumed one does", async () => {
  await withMigrated("http_session_expiry", async (fixture) => {
    const token = "b".repeat(64)
    const tokenFile = join(fixture.dataDirectory, "api-token")
    writeFileSync(tokenFile, token, { mode: 0o600 })
    const hour = 60 * 60_000
    const loginAt = Date.parse("2026-09-01T10:00:00.000Z")
    let at = loginAt
    const running = await startServer(fixture.config({ port: 0, authTokenFile: tokenFile }), fixture.pool,
      () => Promise.resolve(true), apiDocsResponse(allPlugins), { now: () => at })
    const expiry = async () => Number(await fixture.sql.scalar("SELECT expires_at FROM browser_sessions"))
    try {
      if (!running.server.listening) await once(running.server, "listening")
      const origin = `http://127.0.0.1:${String((running.server.address() as AddressInfo).port)}`
      const login = await fetch(`${origin}/api/session`, {
        method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ token }),
      })
      assert.equal(login.status, 200)
      const cookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0] as string
      const { csrfToken } = await login.json() as { readonly csrfToken: string }

      at = loginAt + hour
      const statuses: Array<number> = []
      for (const headers of [{ cookie, origin, "x-csrf-token": `${csrfToken}x` }, { cookie, origin },
        { cookie, origin: "http://attacker.example", "x-csrf-token": csrfToken }]) {
        statuses.push((await fetch(`${origin}/api/session`, { method: "DELETE", headers })).status)
      }
      // Wrong token and foreign Origin: 403 from the group; no token at all: 400 from the header schema.
      assert.deepEqual(statuses, [403, 400, 403])
      assert.equal(await expiry(), loginAt + 12 * hour, "a refused logout leaves expires_at alone")

      assert.equal((await fetch(`${origin}/api/session`, { headers: { cookie } })).status, 200)
      assert.equal(await expiry(), loginAt + 13 * hour)
    } finally {
      await running.close()
    }
  })
})
