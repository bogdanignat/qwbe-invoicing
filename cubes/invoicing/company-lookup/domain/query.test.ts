import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../../contracts/failures.ts"
import { MAX_NAME_LENGTH, MIN_CUI_DIGITS, MIN_NAME_LETTERS, cuiQuery, nameQuery, normalizeCui } from "./query.ts"

const refusal = (run: () => unknown): ReadonlyArray<string> => {
  try { run() } catch (error) { if (error instanceof ValidationFailure) return error.issues; throw error }
  assert.fail("expected a ValidationFailure")
}

void test("the thresholds are the ones Bogdan fixed", () => {
  assert.deepEqual([MIN_CUI_DIGITS, MIN_NAME_LETTERS, MAX_NAME_LENGTH], [4, 6, 100])
})

void test("a CUI is trimmed, upper-cased and loses its RO prefix", () => {
  assert.equal(normalizeCui("  ro 12345674 "), "12345674")
  assert.equal(normalizeCui("RO12345674"), "12345674")
  assert.equal(cuiQuery(" ro12345674"), "12345674")
  assert.equal(cuiQuery("1235"), "1235", "four digits with a valid check digit")
})

void test("a CUI query is refused when it is not digits, too short or has a wrong check digit", () => {
  assert.deepEqual(refusal(() => cuiQuery("12A45674")), ["cui must contain only digits"])
  assert.deepEqual(refusal(() => cuiQuery("")), ["cui must contain only digits"])
  assert.deepEqual(refusal(() => cuiQuery("RO")), ["cui must contain only digits"])
  assert.deepEqual(refusal(() => cuiQuery("124")), ["cui must have at least 4 digits"], "valid check digit, three digits")
  assert.deepEqual(refusal(() => cuiQuery("12345675")), ["cui must be a valid Romanian CUI"])
  assert.deepEqual(refusal(() => cuiQuery("01235")), ["cui must be a valid Romanian CUI"], "a leading zero is not a CUI")
  assert.deepEqual(refusal(() => cuiQuery("12345678901")), ["cui must be a valid Romanian CUI"], "more than ten digits")
})

void test("a name query counts letters, not characters, and is trimmed", () => {
  assert.equal(nameQuery("  Ștefan SRL "), "Ștefan SRL")
  assert.deepEqual(refusal(() => nameQuery("A.B. 12 C-D")), ["q must have at least 6 letters"])
  assert.deepEqual(refusal(() => nameQuery("      ")), ["q must have at least 6 letters"])
  assert.equal(nameQuery("Țară Ăă"), "Țară Ăă", "six letters with diacritics")
  assert.deepEqual(refusal(() => nameQuery("Țară Ă")), ["q must have at least 6 letters"])
})

void test("a name query is refused above the length cap, after trimming", () => {
  assert.equal(nameQuery(` ${"a".repeat(MAX_NAME_LENGTH)} `).length, MAX_NAME_LENGTH)
  assert.deepEqual(refusal(() => nameQuery("a".repeat(MAX_NAME_LENGTH + 1))), ["q must have at most 100 characters"])
})
