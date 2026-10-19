import assert from "node:assert/strict"
import test from "node:test"

import { requestTarget, routerPath } from "./edge-target.ts"

void test("the raw request-target keeps encoded IDs and the query as sent", () => {
  assert.deepEqual(requestTarget("/"), { path: "/" })
  assert.deepEqual(requestTarget("/api/customers?limit=1&limit=2"), { path: "/api/customers" })
  assert.deepEqual(requestTarget("/api/documents/customer%2F1?a=1&a=2&v=%25"), { path: "/api/documents/customer%2F1" })
  assert.deepEqual(requestTarget("/api/customers/v%25"), { path: "/api/customers/v%25" })
  assert.deepEqual(requestTarget("/api/customers/"), { path: "/api/customers/" })
  assert.deepEqual(requestTarget("/api/invoices/a.b..c"), { path: "/api/invoices/a.b..c" })
})

void test("a target that a URL parser would rewrite is refused before it is classified", () => {
  for (const target of [
    undefined, "", "*", "api", "http://invoice.test/api/customers", "//evil.test/api", "/api//customers",
    "/api/../health/live", "/api/./customers", "/api/%2e%2e/health/live", "/api/%2E%2E/health/live", "/api/.%2e/x",
    "/api/%252e%252e/health/live", "/api/%25252e%25252e/x", "/api/customer%2F..%2Fx", "/api/a\\b", "/api/a%5Cb",
    "/api/a%00b", "/api/a%0Ab", "/api/a%7Fb", "/api/%zz", "/api/customers#fragment",
  ]) {
    assert.equal(requestTarget(target), undefined, `${String(target)} must be refused`)
  }
})

void test("a segment still changing after the last decoding is refused, not passed on", () => {
  // Five layers of `%25` over `.`: still changing after the fourth decoding.
  assert.equal(requestTarget("/api/%25252525252e"), undefined)
})

void test("escapes of unreserved characters and `;` are refused: the API router would read them as another path", () => {
  for (const target of ["/api/%73ession", "/api/%73%65%73%73%69%6f%6e", "/api/SESSI%4FN", "/api/session%2D1", "/api/a%5Fb",
    "/api/a%7Eb", "/api/%30", "/api/session;x", "/api/session;", "/api;/session"]) {
    assert.equal(requestTarget(target), undefined, `${target} must be refused`)
  }
  // Reserved and non-ASCII escapes keep their meaning in the router, so encoded IDs pass.
  for (const target of ["/api/documents/a%2Fb", "/api/customers/v%25", "/api/customers/a%20b", "/api/customers/%C8%99",
    "/api/customers/a%3Ab%40c", "/api/customers/x?q=a;b"]) {
    assert.ok(requestTarget(target), `${target} must pass`)
  }
})

void test("routerPath folds what find-my-way-ts folds: case and one trailing slash", () => {
  for (const path of ["/api/session", "/api/session/", "/api/Session", "/API/SESSION/"]) assert.equal(routerPath(path), "/api/session")
  assert.equal(routerPath("/"), "/")
  assert.equal(routerPath("/api/customers/AbC"), "/api/customers/abc")
})
