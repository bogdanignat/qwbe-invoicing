import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../contracts/failures.ts"
import { normalizeUnitOfMeasure, unitOfMeasures } from "./unit-of-measures.ts"

void test("publishes unique Peppol unit codes from UN/ECE Recommendations 20 and 21", () => {
  assert.equal(new Set(unitOfMeasures.map(({ code }) => code)).size, unitOfMeasures.length)
  assert.deepEqual(unitOfMeasures.find(({ code }) => code === "HUR"), { code: "HUR", name: "hour" })
  assert.deepEqual(unitOfMeasures.find(({ code }) => code === "X1A"), { code: "X1A", name: "Drum, steel" })
  assert.equal(unitOfMeasures.some(({ code }) => code === "1A"), false)
})

void test("validates the authoritative code while preserving the caller-facing snapshot name", () => {
  assert.deepEqual(normalizeUnitOfMeasure({ code: "HUR", name: "oră" }), { code: "HUR", name: "oră" })
  assert.throws(() => normalizeUnitOfMeasure({ code: "NOPE", name: "inventată" }), ValidationFailure)
  assert.throws(() => normalizeUnitOfMeasure({ code: "HUR", name: " oră " }), ValidationFailure)
})
