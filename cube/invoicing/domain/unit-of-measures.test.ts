import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../contracts/failures.ts"
import { normalizeUnitOfMeasure, unitOfMeasures } from "./unit-of-measures.ts"

void test("publishes only the curated Romanian invoicing units, piece first, with UN/ECE codes", () => {
  assert.equal(new Set(unitOfMeasures.map(({ code }) => code)).size, unitOfMeasures.length)
  assert.ok(unitOfMeasures.length < 40, "the catalogue must stay a short curated list, not the full Rec 20/21")
  assert.deepEqual(unitOfMeasures[0], { code: "H87", name: "bucată" })
  assert.deepEqual(unitOfMeasures.find(({ code }) => code === "HUR"), { code: "HUR", name: "oră" })
  assert.deepEqual(unitOfMeasures.find(({ code }) => code === "MON"), { code: "MON", name: "lună" })
  assert.equal(unitOfMeasures.some(({ code }) => code === "X1A"), false, "steel drums are not a Romanian invoicing unit")
  assert.ok(unitOfMeasures.every(({ code }) => /^[A-Z0-9]{2,3}$/.test(code)))
})

void test("validates the curated code while preserving the caller-facing snapshot name", () => {
  assert.deepEqual(normalizeUnitOfMeasure({ code: "HUR", name: "ore" }), { code: "HUR", name: "ore" })
  assert.throws(() => normalizeUnitOfMeasure({ code: "X1A", name: "butoi" }), ValidationFailure)
  assert.throws(() => normalizeUnitOfMeasure({ code: "NOPE", name: "inventată" }), ValidationFailure)
  assert.throws(() => normalizeUnitOfMeasure({ code: "HUR", name: " oră " }), ValidationFailure)
})
