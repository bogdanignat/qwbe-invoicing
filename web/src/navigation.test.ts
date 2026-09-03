import assert from "node:assert/strict"
import test from "node:test"

import { routeFromPathname } from "./navigation.ts"

void test("maps entry-page aliases to the unlock route", () => {
  assert.equal(routeFromPathname("/"), "/unlock")
  assert.equal(routeFromPathname("/app"), "/unlock")
})

void test("preserves clean application routes", () => {
  assert.equal(routeFromPathname("/invoices"), "/invoices")
  assert.equal(routeFromPathname("/drafts/draft-1"), "/drafts/draft-1")
})
