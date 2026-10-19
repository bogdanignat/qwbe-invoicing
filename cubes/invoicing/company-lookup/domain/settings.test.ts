import assert from "node:assert/strict"
import test from "node:test"
import { inspect } from "node:util"

import { Redacted } from "effect"

import { ValidationFailure } from "../../contracts/failures.ts"
import { applySettingsUpdate, defaultSettings, settingsView, validateSettingsUpdate, type CompanyLookupSettings, type SettingsUpdate } from "./settings.ts"

const key = Redacted.make("sk_test_0123456789abcd")
const configured: CompanyLookupSettings = { provider: "none", openapiKey: key }
const issues = (update: SettingsUpdate, current: CompanyLookupSettings = defaultSettings): ReadonlyArray<string> => {
  try { validateSettingsUpdate(update, current) } catch (error) { if (error instanceof ValidationFailure) return error.issues; throw error }
  assert.fail("expected a ValidationFailure")
}

void test("the provider comes from the enum", () => {
  for (const provider of ["none", "anaf"]) assert.equal(validateSettingsUpdate({ provider }, defaultSettings).provider, provider)
  for (const provider of ["", "ANAF", "openapi.ro", "termene"]) {
    assert.deepEqual(issues({ provider }), ["provider must be one of none, anaf, openapi"], provider)
  }
})

void test("openapi needs a key that is configured, or set in the same update", () => {
  assert.deepEqual(issues({ provider: "openapi" }), ["provider openapi requires a configured openapiKey"])
  assert.deepEqual(issues({ provider: "openapi", clearOpenapiKey: true }, configured), ["provider openapi requires a configured openapiKey"])
  assert.deepEqual(validateSettingsUpdate({ provider: "openapi" }, configured), { provider: "openapi", openapiKey: { kind: "keep" } })
  assert.deepEqual(validateSettingsUpdate({ provider: "openapi", openapiKey: key }, defaultSettings), { provider: "openapi", openapiKey: { kind: "set", key } })
})

void test("a written key is 10 to 200 visible ASCII characters", () => {
  const accepted = (value: string) => validateSettingsUpdate({ provider: "none", openapiKey: Redacted.make(value) }, defaultSettings)
  assert.equal(accepted("a".repeat(10)).openapiKey.kind, "set")
  assert.equal(accepted("~".repeat(200)).openapiKey.kind, "set")
  const message = "openapiKey must be 10 to 200 printable ASCII characters without spaces"
  for (const value of ["a".repeat(9), "a".repeat(201), "abcdefghij ", "abcde\nfghij", "cheie-ăîșțâ-1", ""]) {
    assert.deepEqual(issues({ provider: "none", openapiKey: Redacted.make(value) }), [message], JSON.stringify(value.length))
  }
})

void test("a key cannot be set and cleared at once", () => {
  assert.deepEqual(issues({ provider: "anaf", openapiKey: key, clearOpenapiKey: true }), ["openapiKey and clearOpenapiKey cannot be combined"])
})

void test("the view shows whether a key exists and its last four characters, never the key", () => {
  assert.deepEqual(settingsView(defaultSettings), { provider: "none", openapiKeyConfigured: false, openapiKeyLast4: null })
  const view = settingsView({ provider: "openapi", openapiKey: key })
  assert.deepEqual(view, { provider: "openapi", openapiKeyConfigured: true, openapiKeyLast4: "abcd" })
  assert.doesNotMatch(JSON.stringify(view), /sk_test/u)
  assert.doesNotMatch(`${inspect(key)} ${JSON.stringify({ key })}`, /sk_test/u, "the redacted key does not print")
})

void test("applying an update keeps, replaces or clears the key", () => {
  const other = Redacted.make("another-key-9999")
  assert.equal(applySettingsUpdate(configured, { provider: "anaf", openapiKey: { kind: "keep" } }).openapiKey, key)
  assert.equal(applySettingsUpdate(configured, { provider: "openapi", openapiKey: { kind: "set", key: other } }).openapiKey, other)
  assert.deepEqual(applySettingsUpdate(configured, { provider: "anaf", openapiKey: { kind: "clear" } }), { provider: "anaf" })
})
