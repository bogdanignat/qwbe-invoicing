import assert from "node:assert/strict"
import test from "node:test"

import { browserApiPath } from "./api-path.ts"

void test("answers a same-origin API path unchanged, encoded ids and repeated query included", () => {
  for (const path of [
    "/api/session",
    "/api/customers/customer%2F1?tag=a&tag=b",
    "/api/product-presets/preset%251",
    "/api/invoices/inv%2E%2E?q=..",
    "/api/reports/revenue?from=2025-11-01&to=2026-10-19",
  ]) {
    assert.equal(browserApiPath(path), path)
  }
})

void test("refuses external URLs, the retired proxy prefix and paths that leave /api/", () => {
  for (const path of [
    "https://example.test/api/session",
    "//example.test/api/session",
    "api/session",
    "/api",
    "/apis/session",
    "/api/qwbe/session",
    "/api/qwbe",
    "/api/qwbe?x=1",
    "/api/../health/live",
    "/api/./session",
    "/api/invoices/..",
    "/api\\..\\health",
    "/api/%2e%2e/health/live",
    "/api/%2E%2E/health/live",
    "/api/.%2e/health/live",
    "/api/%2e./health/live",
    "/api/invoices/%2e%2e",
    "/api/%2e/session",
    "/api/a/b/%2e%2e/%2e%2e/%2e%2e/health",
    "/api/invoices/a b",
  ]) {
    assert.throws(() => browserApiPath(path), /Calea API este invalidă/, path)
  }
})
