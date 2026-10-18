import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../contracts/failures.ts"
import { normalizeUnitOfMeasure, unitOfMeasures } from "./unit-of-measures.ts"

void test("publishes only the curated Romanian invoicing units, piece first, with UN/ECE codes", () => {
  assert.equal(new Set(unitOfMeasures.map(({ code }) => code)).size, unitOfMeasures.length)
  assert.deepEqual(unitOfMeasures, [
    { code: "H87", name: "bucată" },
    { code: "C62", name: "unitate" },
    { code: "HUR", name: "oră" },
    { code: "KGM", name: "kilogram" },
    { code: "LTR", name: "litru" },
    { code: "MTR", name: "metru" },
    { code: "MTK", name: "metru pătrat" },
    { code: "MTQ", name: "metru cub" },
  ], "keep the catalogue limited to practical units, not every available UN/ECE code")
  assert.ok(unitOfMeasures.every(({ code }) => /^[A-Z0-9]{2,3}$/.test(code)))
})

void test("rejects removed calendar, packaging and redundant units for new input", () => {
  for (const code of ["DAY", "WEE", "MON", "ANN", "MIN", "GRM", "TNE", "MLT", "CMT", "MMT", "KMT", "SET", "PR", "KWH", "LS", "E48", "XPK", "XBX"]) {
    assert.throws(() => normalizeUnitOfMeasure({ code, name: "unitate eliminată" }), ValidationFailure, code)
  }
})

void test("validates the curated code while preserving the caller-facing snapshot name", () => {
  assert.deepEqual(normalizeUnitOfMeasure({ code: "HUR", name: "ore" }), { code: "HUR", name: "ore" })
  assert.throws(() => normalizeUnitOfMeasure({ code: "X1A", name: "butoi" }), ValidationFailure)
  assert.throws(() => normalizeUnitOfMeasure({ code: "NOPE", name: "inventată" }), ValidationFailure)
  assert.throws(() => normalizeUnitOfMeasure({ code: "HUR", name: " oră " }), ValidationFailure)
})
