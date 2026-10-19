import assert from "node:assert/strict"
import test from "node:test"

import { CALLBACK_OUTCOMES, attemptOutcome, callbackTarget, cifOutcome, spvCif, usableCode } from "./callback.ts"

void test("the callback lands on one fixed page, with one of a fixed set of plain codes", () => {
  assert.equal(callbackTarget("conectat"), "/settings/integrations?anaf=conectat")
  for (const outcome of CALLBACK_OUTCOMES) assert.match(callbackTarget(outcome), /^\/settings\/integrations\?anaf=[a-z_]+$/u)
  for (const outcome of [...Object.values(attemptOutcome), ...Object.values(cifOutcome)]) assert.ok(CALLBACK_OUTCOMES.includes(outcome))
})

void test("the SPV CIF is the issuer's identifier without RO, digits only", () => {
  assert.equal(spvCif("RO12345674"), "12345674")
  assert.equal(spvCif(" ro 12345674 "), "12345674")
  assert.equal(spvCif("12345674"), "12345674")
  for (const value of ["", "RO", "RO-123", "1", "12345678901", "DE123456789", "1234 5674"]) assert.equal(spvCif(value), undefined, value)
})

void test("a code is one bounded run of printable characters", () => {
  assert.equal(usableCode("eyJ.abc-_~"), true)
  for (const value of [undefined, "", "a b", "a\nb", "ț", "x".repeat(4097)]) assert.equal(usableCode(value), false, String(value))
})
