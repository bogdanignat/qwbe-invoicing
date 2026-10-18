import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { Effect } from "effect"

import { activePayments } from "./api/api-services.ts"
import { createRequestAuthenticator } from "./auth/auth.ts"
import { runtimeConfig } from "./config.ts"
import { allPlugins, optionalPlugins, parsePlugins } from "./plugins.ts"

const none = { payments: false, efactura: false }

void test("QWBE_PLUGINS absent runs every optional plugin", () => {
  assert.deepEqual(parsePlugins(undefined), allPlugins)
  assert.deepEqual(runtimeConfig({ NODE_ENV: "test" }).plugins, allPlugins)
})

void test("QWBE_PLUGINS empty runs no optional plugin", () => {
  for (const value of ["", " ", ",", " , , "]) assert.deepEqual(parsePlugins(value), none, JSON.stringify(value))
  assert.deepEqual(runtimeConfig({ NODE_ENV: "test", QWBE_PLUGINS: "" }).plugins, none)
})

void test("QWBE_PLUGINS ignores spaces and tolerates duplicates", () => {
  assert.deepEqual(parsePlugins(" payments "), { payments: true, efactura: false })
  assert.deepEqual(parsePlugins("efactura,efactura , efactura"), { payments: false, efactura: true })
  assert.deepEqual(parsePlugins(" efactura ,payments,payments "), allPlugins)
})

void test("QWBE_PLUGINS refuses an unknown name at startup, with the names it knows", () => {
  for (const value of ["paymnets", "payments,crm", "Payments", "invoicing", "payments;efactura"]) {
    assert.throws(() => parsePlugins(value), /QWBE_PLUGINS names unknown plugins: .* \(known: payments, efactura\)/u, value)
  }
  assert.throws(() => runtimeConfig({ NODE_ENV: "test", QWBE_PLUGINS: "payment" }), /unknown plugins: payment /u)
})

void test("the optional plugins are exactly the declared units with required: false, and the selection covers each", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../qwbe-package.json", import.meta.url), "utf8")) as { cubes: ReadonlyArray<string> }
  const units = await Promise.all(manifest.cubes.map(async (path) =>
    (await import(new URL(`../cubes/${path}/index.ts`, import.meta.url).href) as {
      cube: { manifest: { name: string, required: boolean } } }).cube.manifest))
  assert.equal(units.length, 11)
  assert.deepEqual(units.filter((unit) => !unit.required).map((unit) => unit.name).sort(), [...optionalPlugins].sort())
  assert.deepEqual(Object.keys(allPlugins).sort(), [...optionalPlugins].sort())
})

void test("the payments routes fail closed when the payments service is not composed", () => {
  assert.throws(() => activePayments({} as Parameters<typeof activePayments>[0]), /payments plugin is off/u)
})

void test("the payments grants exist only with the payments plugin on; invoicing:read stays", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-plugins-"))
  try {
    const tokenFile = join(directory, "api-token")
    writeFileSync(tokenFile, "t".repeat(64), { mode: 0o600 })
    const grants = async (QWBE_PLUGINS: string | undefined) => {
      const config = runtimeConfig({ NODE_ENV: "test", AUTH_TOKEN_FILE: tokenFile, ORGANIZATION_ID: "org-1",
        ...(QWBE_PLUGINS === undefined ? {} : { QWBE_PLUGINS }) })
      const context = await Effect.runPromise(createRequestAuthenticator(config)(`Bearer ${"t".repeat(64)}`).current)
      return context.identity.permissions
    }
    const on = await grants(undefined)
    assert.ok(on.includes("payments:read") && on.includes("payments:payment.record") && on.includes("invoicing:read"))
    for (const value of ["", "efactura"]) {
      const off = await grants(value)
      assert.deepEqual(off.filter((name) => name.startsWith("payments:")), [], value)
      assert.ok(off.includes("invoicing:read"), value)
      assert.deepEqual([...off, "payments:read", "payments:payment.record"].sort(), [...on].sort(), value)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
