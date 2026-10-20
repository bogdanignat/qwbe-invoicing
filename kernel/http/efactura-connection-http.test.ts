import assert from "node:assert/strict"
import test from "node:test"

import { CALLBACK_OUTCOMES } from "../../cubes/invoicing/efactura/connection/index.ts"
import { anafSettingsFor } from "../efactura/anaf/connection.test-support.ts"
import { startFakeAnaf } from "../efactura/anaf/fake-anaf.test-support.ts"
import { allPlugins } from "../plugins.ts"
import { withMigrated } from "../storage/postgres-rig.test-support.ts"
import { documentedPaths, ok, seed, serve, type Served } from "./plugins-http.test-support.ts"

/**
 * The ANAF connection through the real listener: the edge guard, the forward to
 * the API and back. The callback is the one `/api/*` route a browser reaches
 * without a session; every other connection route keeps the login and CSRF.
 */
const raw = (served: Served, method: string, path: string, headers: Record<string, string> = {}) =>
  fetch(`${served.origin}${path}`, { method, headers, redirect: "manual" })

const cookieOf = (response: Response): string => (response.headers.getSetCookie()[0] ?? "").split(";", 1)[0] ?? ""

void test("start sets the attempt cookie, the callback passes without a session and answers only the fixed 303", async () => {
  await withMigrated("efhttp_flow", async (fixture) => {
    const fake = await startFakeAnaf()
    const served = await serve(fixture, allPlugins, { settings: anafSettingsFor(), transport: fake.transport })
    try {
      await seed(served)
      const session = { cookie: served.cookie, origin: served.origin }
      assert.equal((await raw(served, "GET", "/api/efactura/connection")).status, 401, "status keeps the login")
      assert.equal((await raw(served, "POST", "/api/efactura/connection/start", { origin: served.origin })).status, 401)
      assert.equal((await raw(served, "DELETE", "/api/efactura/connection", { origin: served.origin })).status, 401)
      assert.equal((await raw(served, "POST", "/api/efactura/connection/start", session)).status, 403, "and the CSRF token")

      const started = await raw(served, "POST", "/api/efactura/connection/start", { ...session, "x-csrf-token": served.csrfToken })
      assert.equal(started.status, 200)
      const [setCookie] = started.headers.getSetCookie()
      assert.match(setCookie ?? "", /^qwbe_anaf_oauth=[A-Za-z0-9_-]{43}; Max-Age=600; Path=\/api\/anaf; HttpOnly; Secure; SameSite=Lax$/u)
      const authorize = new URL((await started.json() as { authorizeUrl: string }).authorizeUrl)
      assert.equal(`${authorize.origin}${authorize.pathname}`, "https://logincert.anaf.ro/anaf-oauth2/v1/authorize")
      assert.deepEqual([...authorize.searchParams.keys()].sort(), ["client_id", "redirect_uri", "response_type", "token_content_type"])
      assert.deepEqual([authorize.searchParams.get("response_type"), authorize.searchParams.get("token_content_type")], ["code", "jwt"])

      const callback = await raw(served, "GET", "/api/anaf/callback?code=LISTENER-CODE", { cookie: cookieOf(started) })
      assert.equal(callback.status, 303)
      assert.equal(callback.headers.get("location"), "/settings/integrations?anaf=conectat")
      assert.equal(callback.headers.get("cache-control"), "no-store")
      assert.equal(callback.headers.get("referrer-policy"), "no-referrer")
      assert.deepEqual(callback.headers.getSetCookie(), ["qwbe_anaf_oauth=; Max-Age=0; Path=/api/anaf; HttpOnly; Secure; SameSite=Lax"])
      assert.equal((await ok(served.call("GET", "/api/efactura/connection"), "status")).status, "connected")

      for (const [headers, query] of [[{}, "?code=x"], [{ cookie: cookieOf(started) }, "?code=x"], [{ cookie: served.cookie }, "?error=x"]] as const) {
        const refused = await raw(served, "GET", `/api/anaf/callback${query}`, headers)
        assert.equal(refused.status, 303)
        const location = refused.headers.get("location") ?? ""
        assert.match(location, /^\/settings\/integrations\?anaf=[a-z_]+$/u)
        assert.ok(CALLBACK_OUTCOMES.some((outcome) => location.endsWith(`=${outcome}`)), location)
        assert.notEqual(location, "/settings/integrations?anaf=conectat")
      }
      assert.equal((await raw(served, "POST", "/api/anaf/callback", { origin: served.origin })).status, 405, "GET only")

      const disconnected = await ok(served.call("DELETE", "/api/efactura/connection"), "disconnect")
      assert.equal(disconnected.status, "disconnected")
      const paths = await documentedPaths(served.call)
      for (const path of ["/api/efactura/connection", "/api/efactura/connection/start", "/api/anaf/callback"]) assert.ok(paths.includes(path), path)
    } finally {
      await served.close()
      await fake.close()
    }
  })
})

void test("without the ANAF variables the status says so and start answers 409", async () => {
  await withMigrated("efhttp_unconfigured", async (fixture) => {
    const served = await serve(fixture, allPlugins)
    try {
      assert.equal((await ok(served.call("GET", "/api/efactura/connection"), "status")).status, "not_configured")
      const started = await served.call("POST", "/api/efactura/connection/start")
      assert.deepEqual([started.status, started.body], [409, { error: "DomainConflict", code: "efactura_not_configured" }])
      const callback = await raw(served, "GET", "/api/anaf/callback?code=x", { cookie: `qwbe_anaf_oauth=${"a".repeat(43)}` })
      assert.equal(callback.headers.get("location"), "/settings/integrations?anaf=neconfigurat")
    } finally {
      await served.close()
    }
  })
})

void test("with e-Factura off the connection routes and the callback are absent, and missing from OpenAPI", async () => {
  await withMigrated("efhttp_off", async (fixture) => {
    const served = await serve(fixture, { ...allPlugins, efactura: false }, { settings: anafSettingsFor() })
    try {
      for (const [method, path] of [["GET", "/api/efactura/connection"], ["POST", "/api/efactura/connection/start"],
        ["DELETE", "/api/efactura/connection"], ["GET", "/api/anaf/callback?code=x"]] as const) {
        const reply = await served.call(method, path)
        assert.deepEqual([reply.status, reply.body], [404, { error: "not_found" }], `${method} ${path}`)
      }
      const paths = await documentedPaths(served.call)
      assert.equal(paths.some((path) => path.startsWith("/api/efactura/") || path.startsWith("/api/anaf/")), false)
    } finally {
      await served.close()
    }
  })
})
