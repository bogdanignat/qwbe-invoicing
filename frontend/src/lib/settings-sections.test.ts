import assert from "node:assert/strict"
import test from "node:test"

import { settingsSections } from "./settings-sections.ts"

void test("with company-lookup on: Emitent at /settings, Integrări beside it, one current", () => {
  const sections = settingsSections(true, "integrations")
  assert.deepEqual(sections.map((link) => [link.href, link.label, link.current]), [
    ["/settings", "Emitent", false], ["/settings/integrations", "Integrări", true],
  ])
  assert.deepEqual(settingsSections(true, "issuer").filter((link) => link.current).map((link) => link.href), ["/settings"])
})

void test("with company-lookup off there is no settings menu at all", () => {
  assert.deepEqual(settingsSections(false, "issuer"), [])
  assert.deepEqual(settingsSections(false, "integrations"), [])
})
