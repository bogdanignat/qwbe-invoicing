import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { runtimeConfig } from "../config.ts"
import { assertServableOrigin, edgePolicyFor } from "./edge-server.ts"
import { edgeConfig, startEdgeServer } from "./edge-server.test-support.ts"

const productionEnvironment = (): NodeJS.ProcessEnv => {
  const secret = join(mkdtempSync(join(tmpdir(), "qwbe-config-")), "pg-password")
  writeFileSync(secret, "not-a-real-password", { mode: 0o600 })
  return { NODE_ENV: "production", PGPASSWORD_FILE: secret }
}

void test("PUBLIC_ORIGIN is optional for every command and validated canonically whenever it is set", () => {
  // `migrate`, `backup`, `restore` and `doctor` read the same configuration and
  // never serve HTTP: production without PUBLIC_ORIGIN still configures.
  assert.equal(runtimeConfig(productionEnvironment()).publicOrigin, undefined)
  for (const value of ["https://invoice.example.com", "http://127.0.0.1:3000", "https://[::1]:8443"]) {
    assert.equal(runtimeConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: value }).publicOrigin, value)
  }
  for (const value of ["", " ", "invoice.example.com", "https://invoice.example.com/", "https://invoice.example.com/app",
    "https://user:pass@invoice.example.com", "https://Invoice.example.com", "https://invoice.example.com:443",
    "ftp://invoice.example.com", "https://invoice.example.com?x=1", "https://invoice.example.com#x", "javascript:alert(1)"]) {
    assert.throws(() => runtimeConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: value }), /PUBLIC_ORIGIN must be a canonical/u, value)
  }
})

void test("QWBE_BEARER_API is off unless it says on, and anything else refuses to start", () => {
  for (const value of [undefined, "", "off"]) {
    assert.equal(runtimeConfig({ NODE_ENV: "test", ...(value === undefined ? {} : { QWBE_BEARER_API: value }) }).bearerApi, false)
  }
  assert.equal(runtimeConfig({ NODE_ENV: "test", QWBE_BEARER_API: "on" }).bearerApi, true)
  for (const value of ["ON", "true", "1", "yes", " on"]) {
    assert.throws(() => runtimeConfig({ NODE_ENV: "test", QWBE_BEARER_API: value }), /QWBE_BEARER_API must be on or off/u, value)
  }
})

void test("serving needs a canonical origin: required in production, loopback-only without one elsewhere", async () => {
  assert.throws(() => { assertServableOrigin(edgeConfig({ nodeEnvironment: "production", publicOrigin: undefined })) },
    /PUBLIC_ORIGIN is required to serve in production/u)
  assert.throws(() => { assertServableOrigin(edgeConfig({ host: "0.0.0.0", publicOrigin: undefined })) },
    /PUBLIC_ORIGIN is required unless HOST is a loopback address/u)
  assert.doesNotThrow(() => { assertServableOrigin(edgeConfig({ nodeEnvironment: "production", host: "0.0.0.0" })) })
  for (const host of ["127.0.0.1", "::1", "localhost"]) {
    assert.doesNotThrow(() => { assertServableOrigin(edgeConfig({ host, publicOrigin: undefined })) })
  }
  // The loopback default is the address actually bound, so it is pinned too.
  assert.equal(edgePolicyFor(edgeConfig({ publicOrigin: undefined }), { address: "127.0.0.1", family: "IPv4", port: 4711 }).origin.origin,
    "http://127.0.0.1:4711")
  assert.equal(edgePolicyFor(edgeConfig({ host: "::1", publicOrigin: undefined }), { address: "::1", family: "IPv6", port: 4711 }).origin.origin,
    "http://[::1]:4711")
  // `startServer` refuses before it listens: nothing is bound and no handler is created.
  let created = 0
  await assert.rejects(startEdgeServer({ config: { nodeEnvironment: "production", publicOrigin: undefined },
    dependencies: { apiHandlerFactory: () => { created += 1; throw new Error("must not be created") } } }),
  /PUBLIC_ORIGIN is required to serve in production/u)
  assert.equal(created, 0)
})
