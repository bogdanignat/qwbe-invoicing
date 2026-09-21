import assert from "node:assert/strict"
import test from "node:test"

import { countyRequiresSector, isRomanianCountyCode, ROMANIAN_COUNTIES, romanianCountyName } from "./romanian-counties.ts"

void test("exposes the complete unique ISO 3166-2 Romanian county catalogue", () => {
  assert.equal(ROMANIAN_COUNTIES.length, 42)
  assert.equal(new Set(ROMANIAN_COUNTIES.map(({ code }) => code)).size, 42)
  assert.equal(new Set(ROMANIAN_COUNTIES.map(({ name }) => name)).size, 42)
  assert.equal(isRomanianCountyCode("RO-B"), true)
  assert.equal(isRomanianCountyCode("București"), false)
  assert.equal(romanianCountyName("RO-IS"), "Iași")
  assert.equal(countyRequiresSector("RO-B"), true)
  assert.equal(countyRequiresSector("RO-IF"), false)
})
