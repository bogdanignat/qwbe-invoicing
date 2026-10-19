import assert from "node:assert/strict"
import test from "node:test"

import {
  EMPTY_KEY_FIELD, OPENAPI_NEEDS_KEY, decodeCompanyLookupSettings, keyClear, keyFieldAfterSave, keySave, keyStatus, providerToggle,
  type CompanyLookupSettings, type LookupProvider,
} from "./company-lookup-settings.ts"

const withKey = (provider: LookupProvider): CompanyLookupSettings =>
  ({ provider, openapiKeyConfigured: true, openapiKeyLast4: "wxyz" })
const noKey = (provider: LookupProvider): CompanyLookupSettings =>
  ({ provider, openapiKeyConfigured: false, openapiKeyLast4: null })
const sent = (change: ReturnType<typeof providerToggle>) => change.kind === "save" ? change.input : change.kind

void test("decodes the settings answer exactly as the kernel states it", () => {
  assert.deepEqual(decodeCompanyLookupSettings({ provider: "none", openapiKeyConfigured: false, openapiKeyLast4: null }), noKey("none"))
  assert.deepEqual(decodeCompanyLookupSettings({ provider: "openapi", openapiKeyConfigured: true, openapiKeyLast4: "wxyz" }), withKey("openapi"))
})

void test("refuses an answer outside the contract, including a configured key without its ending", () => {
  for (const input of [
    null, [], {}, { provider: "crm", openapiKeyConfigured: false, openapiKeyLast4: null },
    { provider: "anaf" }, { provider: "anaf", openapiKeyConfigured: "yes", openapiKeyLast4: null },
    { provider: "anaf", openapiKeyConfigured: true, openapiKeyLast4: null },
    { provider: "anaf", openapiKeyConfigured: false, openapiKeyLast4: "wxyz" },
    { provider: "anaf", openapiKeyConfigured: true, openapiKeyLast4: 1234 },
  ]) assert.throws(() => decodeCompanyLookupSettings(input), JSON.stringify(input))
})

void test("the switches are exclusive: turning one on replaces the other, turning it off leaves none", () => {
  assert.deepEqual(sent(providerToggle(withKey("none"), "anaf", true)), { provider: "anaf" })
  assert.deepEqual(sent(providerToggle(withKey("anaf"), "openapi", true)), { provider: "openapi" })
  assert.deepEqual(sent(providerToggle(withKey("openapi"), "anaf", true)), { provider: "anaf" })
  assert.deepEqual(sent(providerToggle(withKey("anaf"), "anaf", false)), { provider: "none" })
  assert.deepEqual(sent(providerToggle(withKey("openapi"), "openapi", false)), { provider: "none" })
})

void test("a switch already where it is asked to go sends nothing", () => {
  assert.equal(sent(providerToggle(withKey("anaf"), "anaf", true)), "none")
  assert.equal(sent(providerToggle(withKey("anaf"), "openapi", false)), "none")
  assert.equal(sent(providerToggle(noKey("none"), "anaf", false)), "none")
})

void test("openapi.ro without a stored key is explained, not sent", () => {
  assert.deepEqual(providerToggle(noKey("anaf"), "openapi", true), { kind: "issue", message: OPENAPI_NEEDS_KEY })
  // Turning ANAF off still works without a key.
  assert.deepEqual(sent(providerToggle(noKey("anaf"), "anaf", false)), { provider: "none" })
})

void test("saving a key keeps the provider and drops paste whitespace; an empty draft is refused locally", () => {
  assert.deepEqual(sent(keySave(noKey("anaf"), "  abcdefghijwxyz\n")), { provider: "anaf", openapiKey: "abcdefghijwxyz" })
  assert.deepEqual(sent(keySave(withKey("openapi"), "newkeynewkey")), { provider: "openapi", openapiKey: "newkeynewkey" })
  assert.equal(keySave(noKey("none"), " \n ").kind, "issue")
})

void test("deleting the key with openapi.ro on turns it off in the same write", () => {
  assert.deepEqual(sent(keyClear(withKey("openapi"))), { provider: "none", clearOpenapiKey: true })
  assert.deepEqual(sent(keyClear(withKey("anaf"))), { provider: "anaf", clearOpenapiKey: true })
  assert.deepEqual(sent(keyClear(withKey("none"))), { provider: "none", clearOpenapiKey: true })
  assert.equal(sent(keyClear(noKey("anaf"))), "none")
})

void test("the key is shown only by its ending", () => {
  assert.equal(keyStatus(withKey("anaf")), "Cheie configurată, se termină în …wxyz")
  assert.equal(keyStatus(noKey("anaf")), "Nicio cheie configurată.")
})

void test("a key write is the only one that closes the key field; a provider switch is not", () => {
  const target = (change: ReturnType<typeof providerToggle>) => change.kind === "save" ? change.target : change.kind
  assert.equal(target(providerToggle(withKey("none"), "anaf", true)), "provider")
  assert.equal(target(keySave(withKey("anaf"), "abcdefghijwxyz")), "key")
  assert.equal(target(keyClear(withKey("openapi"))), "key")
})

void test("the key field empties only after a key write succeeded, and stays open after a failure", () => {
  const typing = { draft: "abcdefghijwxyz", replacing: true }
  assert.deepEqual(keyFieldAfterSave(typing, "key"), EMPTY_KEY_FIELD)
  assert.equal(keyFieldAfterSave(typing, "failed"), typing)
  assert.equal(keyFieldAfterSave(typing, "provider"), typing)
})
