import assert from "node:assert/strict"
import test from "node:test"

import { pluginActive } from "./plugins.ts"

void test("a plugin is on only when the authenticated session lists it", () => {
  assert.equal(pluginActive({ status: "authenticated", plugins: ["payments"] }, "payments"), true)
  assert.equal(pluginActive({ status: "authenticated", plugins: ["payments"] }, "efactura"), false)
  assert.equal(pluginActive({ status: "authenticated", plugins: [] }, "payments"), false)
})

void test("outside an authenticated session no plugin is on, whatever list is left behind", () => {
  for (const status of ["checking", "locked", "restore-error"] as const) {
    assert.equal(pluginActive({ status, plugins: ["payments", "efactura"] }, "payments"), false, status)
  }
})
