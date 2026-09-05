import assert from "node:assert/strict"
import test from "node:test"

import { staticUiResponse } from "./static-ui.ts"
import { isUiRoute, matchUiRoute } from "./ui-routes.ts"

void test("the SPA route table and the static host agree on every route", () => {
  assert.deepEqual(matchUiRoute("/invoices"), { kind: "invoices" })
  assert.deepEqual(matchUiRoute("/invoices/new"), { kind: "invoice-new" })
  assert.deepEqual(matchUiRoute("/invoices/inv%2F1"), { kind: "invoice", id: "inv/1" })
  assert.deepEqual(matchUiRoute("/drafts/draft-1"), { kind: "draft", id: "draft-1" })
  assert.deepEqual(matchUiRoute("/proformas/p-1"), { kind: "proforma", id: "p-1" })
  assert.deepEqual(matchUiRoute("/unknown"), { kind: "not-found" })
  assert.deepEqual(matchUiRoute("/api/invoices"), { kind: "not-found" })
  for (const path of ["/", "/app", "/unlock", "/invoices", "/invoices/new", "/invoices/x", "/proformas", "/proformas/x", "/drafts/x", "/customers", "/products", "/settings"]) {
    assert.equal(isUiRoute(path), true, path)
    assert.equal(staticUiResponse("GET", path)?.headers["content-type"], "text/html; charset=utf-8", path)
  }
  for (const path of ["/unknown", "/api/invoices", "/health/ready", "/drafts", "/invoices/x/y"]) {
    assert.equal(isUiRoute(path), false, path)
  }
})
