import assert from "node:assert/strict"
import { once } from "node:events"
import { writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import test from "node:test"

import { createApiHandler, type ApiHandler } from "../api/api.ts"
import { createRequestAuthenticator } from "../auth/auth.ts"
import { startServer } from "./http.ts"
import { withEmpty, withMigrated } from "../storage/postgres-rig.test-support.ts"

/**
 * The transport contract. The API handler and the server now take the
 * application pool, and the readiness gate they are handed is asynchronous.
 *
 * The two lifecycle cases still use a stub handler factory and never touch the
 * database, so they run on an unmigrated fixture: what they assert is that the
 * handler is created once and disposed once, which must hold whatever the schema
 * is.
 */

void test("the materialized application contract serves routes and stable transport failures", async () => {
  await withMigrated("http_builder", async (fixture) => {
    const token = "builder-contract-token-".repeat(3)
    const tokenFile = join(fixture.dataDirectory, "api-token")
    writeFileSync(tokenFile, token, { mode: 0o600 })
    const handler = createApiHandler({
      pool: fixture.pool,
      dataDirectory: fixture.dataDirectory,
      authenticate: createRequestAuthenticator(fixture.config({ port: 0, authTokenFile: tokenFile })),
    })
    const call = (path: string, method = "GET", body?: string) => handler.handle(new Request(`http://qwbe.local${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body }),
    }))
    try {
      const success = await call("/api/customers")
      assert.equal(success.status, 200)
      assert.deepEqual(await success.json(), { items: [], nextCursor: null })

      const invalid = await call("/api/customers", "POST", JSON.stringify({ name: 1, address: { city: null } }))
      assert.equal(invalid.status, 400)
      const invalidBody = await invalid.json() as { readonly error: string, readonly issues: ReadonlyArray<string> }
      assert.equal(invalidBody.error, "ValidationFailure")
      assert.ok(invalidBody.issues.length > 1)

      assert.deepEqual(await (await call("/api/invoices?limit=1&limit=2")).json(), {
        error: "ValidationFailure", issues: ["limit and cursor must be supplied at most once"],
      })
      assert.deepEqual(await (await call("/api/not-a-route")).json(), { error: "not_found" })
      assert.deepEqual(await (await call("/api/invoices/missing", "DELETE")).json(), { error: "method_not_allowed" })
    } finally {
      await handler.dispose()
    }
  })
})

void test("one API handler is shared by a server and disposed exactly once when close is repeated", async () => {
  await withEmpty("http_lifecycle", async (fixture) => {
    let creations = 0
    let calls = 0
    let disposals = 0
    const apiHandlerFactory = (): ApiHandler => {
      creations += 1
      return {
        handle: () => { calls += 1; return Promise.resolve(Response.json({ calls })) },
        dispose: () => { disposals += 1; return Promise.resolve() },
      }
    }
    const running = await startServer(
      fixture.config({ port: 0, authTokenFile: undefined }),
      fixture.pool,
      () => Promise.resolve(true),
      undefined,
      { apiHandlerFactory },
    )
    try {
      const address = running.server.address()
      assert.ok(address && typeof address === "object")
      const origin = `http://127.0.0.1:${String(address.port)}`
      assert.equal((await fetch(`${origin}/api/customers`)).status, 200)
      assert.equal((await fetch(`${origin}/api/customers`)).status, 200)
      assert.equal(creations, 1)
      assert.equal(calls, 2)
      await Promise.all([running.close(), running.close()])
      assert.equal(disposals, 1)
    } finally {
      await running.close()
    }
  })
})

void test("an API handler is disposed exactly once when server startup fails", async () => {
  await withEmpty("http_startup", async (fixture) => {
    const occupied = createServer()
    occupied.listen(0, "127.0.0.1")
    await once(occupied, "listening")
    const port = (occupied.address() as AddressInfo).port
    let disposals = 0
    try {
      await assert.rejects(startServer(
        fixture.config({ port, authTokenFile: undefined }),
        fixture.pool,
        () => Promise.resolve(true),
        undefined,
        { apiHandlerFactory: () => ({
          handle: () => Promise.resolve(Response.json({ ok: true })),
          dispose: () => { disposals += 1; return Promise.resolve() },
        }) },
      ), (error: unknown) => error instanceof Error && "code" in error && error.code === "EADDRINUSE")
      assert.equal(disposals, 1)
    } finally {
      await new Promise<void>((resolve, reject) => occupied.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      }))
    }
  })
})
