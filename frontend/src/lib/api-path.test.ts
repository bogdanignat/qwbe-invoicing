import assert from "node:assert/strict"
import test from "node:test"

import { browserApiPath } from "./api-path.ts"

void test("maps one logical API prefix and preserves encoded paths and query", () => {
  assert.equal(browserApiPath("/api/customers/customer%2F1?tag=a&tag=b"), "/api/qwbe/customers/customer%2F1?tag=a&tag=b")
  assert.equal(browserApiPath("/api/product-presets/preset%251"), "/api/qwbe/product-presets/preset%251")
})

void test("rejects non-logical and already mapped paths", () => {
  assert.throws(() => browserApiPath("https://example.test/api/session"), /Calea API logică este invalidă/)
  assert.throws(() => browserApiPath("/api/qwbe/session"), /Calea API logică este invalidă/)
})
