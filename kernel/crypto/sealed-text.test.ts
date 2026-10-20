import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import test from "node:test"

import { Redacted } from "effect"

import { openKey, sealKey } from "../company-lookup/key-cipher.ts"
import { openText, sealText } from "./sealed-text.ts"

const master = Redacted.make(randomBytes(32))
const secret = Redacted.make("eyJhbGciOi.token.value")

void test("a sealed text opens only under the same master key and the same associated data", () => {
  const sealed = sealText(master, "efactura:access:org-1:test:client:1", secret)
  assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/u)
  assert.equal(sealed.includes("eyJ"), false)
  assert.equal(Redacted.value(openText(master, "efactura:access:org-1:test:client:1", sealed) ?? Redacted.make("")), "eyJhbGciOi.token.value")
  for (const other of ["efactura:refresh:org-1:test:client:1", "efactura:access:org-1:test:client:2", "efactura:access:org-1:prod:client:1", ""]) {
    assert.equal(openText(master, other, sealed), undefined, other)
  }
  assert.equal(openText(Redacted.make(randomBytes(32)), "efactura:access:org-1:test:client:1", sealed), undefined)
})

void test("company-lookup keeps its own associated data: the common module and its wrapper read each other", () => {
  const key = Redacted.make("sk_test_0123456789wxyz")
  const viaWrapper = sealKey(master, "org-1", key)
  assert.equal(Redacted.value(openText(master, "company-lookup:openapi-key:org-1", viaWrapper) ?? Redacted.make("")), "sk_test_0123456789wxyz")
  const viaCommon = sealText(master, "company-lookup:openapi-key:org-1", key)
  assert.equal(Redacted.value(openKey(master, "org-1", viaCommon) ?? Redacted.make("")), "sk_test_0123456789wxyz")
  assert.equal(openText(master, "efactura:access:org-1:test:client:1", viaWrapper), undefined, "a company-lookup ciphertext is not a token")
})
