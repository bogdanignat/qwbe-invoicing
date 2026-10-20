import assert from "node:assert/strict"
import test from "node:test"

import { compareDecimal, divideHalfUp, formatDecimal, isCanonicalDecimal, parseDecimal, parseUnsignedDecimal } from "./money.ts"

const beyond2To53 = 9007199254740993n

void test("parses a signed decimal into units of its scale, padding the fraction", () => {
  for (const [value, scale, units] of [
    ["0", 2, 0n], ["-0", 2, 0n], ["-0.00", 2, 0n], ["12.3", 2, 1230n], ["-12.34", 2, -1234n], ["007.50", 2, 750n],
    ["2.5", 4, 25000n], ["-0.0001", 4, -1n], ["90071992547409.93", 2, beyond2To53], ["-900719925474.0993", 4, -beyond2To53],
    ["42", 0, 42n],
  ] as const) {
    assert.deepEqual(parseDecimal(value, scale), { ok: true, units }, `${value} @ ${String(scale)}`)
  }
})

void test("tells a malformed decimal from one with too many decimals", () => {
  for (const value of ["", " 1", "1 ", "+1", "--1", "1e2", ".5", "5.", "-.5", "1,5", "1.2.3", "0x10", "NaN", "Infinity", "١", "1\n"]) {
    assert.deepEqual(parseDecimal(value, 2), { ok: false, reason: "syntax" }, JSON.stringify(value))
  }
  assert.deepEqual(parseDecimal("1.234", 2), { ok: false, reason: "precision" })
  assert.deepEqual(parseDecimal("-0.00001", 4), { ok: false, reason: "precision" })
  assert.deepEqual(parseDecimal("1.0", 0), { ok: false, reason: "precision" })
})

void test("the unsigned parser refuses any sign as syntax, before precision", () => {
  assert.deepEqual(parseUnsignedDecimal("12.34", 2), { ok: true, units: 1234n })
  for (const value of ["-1", "-0", "-0.00", "-1.234"]) {
    assert.deepEqual(parseUnsignedDecimal(value, 2), { ok: false, reason: "syntax" }, value)
  }
  assert.deepEqual(parseUnsignedDecimal("1.234", 2), { ok: false, reason: "precision" })
})

void test("formats units at their scale, negatives included, never as negative zero", () => {
  for (const [units, scale, text] of [
    [0n, 2, "0.00"], [-0n, 2, "0.00"], [5n, 2, "0.05"], [-5n, 2, "-0.05"], [-100n, 2, "-1.00"], [-1234n, 2, "-12.34"],
    [1n, 4, "0.0001"], [-25000n, 4, "-2.5000"], [0n, 4, "0.0000"], [-42n, 0, "-42"], [0n, 0, "0"],
    [beyond2To53, 2, "90071992547409.93"], [-beyond2To53, 4, "-900719925474.0993"],
  ] as const) {
    assert.equal(formatDecimal(units, scale), text, `${String(units)} @ ${String(scale)}`)
  }
  for (const text of ["0.00", "-0.05", "12.30", "-90071992547409.93"]) {
    const parsed = parseDecimal(text, 2)
    assert.ok(parsed.ok)
    assert.equal(formatDecimal(parsed.units, 2), text)
  }
})

void test("rounds half away from zero: just below, at and just above the half, on both signs", () => {
  for (const [numerator, rounded] of [[4999n, 0n], [5000n, 1n], [5001n, 1n], [14999n, 1n], [15000n, 2n], [0n, 0n]] as const) {
    assert.equal(divideHalfUp(numerator, 10_000n), rounded, String(numerator))
    assert.equal(divideHalfUp(-numerator, 10_000n), -rounded, String(-numerator))
  }
  assert.equal(divideHalfUp(1n, 3n), 0n)
  assert.equal(divideHalfUp(2n, 3n), 1n)
  assert.equal(divideHalfUp(3n, 2n), 2n)
  assert.equal(divideHalfUp(-3n, 2n), -2n)
  assert.equal(divideHalfUp(beyond2To53 * 10_000n + 5_000n, 10_000n), beyond2To53 + 1n)
  assert.throws(() => divideHalfUp(1n, 0n), RangeError)
  assert.throws(() => divideHalfUp(1n, -10n), RangeError)
})

void test("half up matches the old non-negative rounding for every remainder", () => {
  for (const denominator of [2n, 3n, 7n, 100n, 10_000n, 20_000n]) {
    for (let numerator = 0n; numerator < 3n * denominator; numerator += 1n) {
      assert.equal(divideHalfUp(numerator, denominator), (numerator + denominator / 2n) / denominator)
    }
  }
})

void test("compares by value at the precision both sides carry, and refuses what does not parse", () => {
  assert.equal(compareDecimal("21", "21.00"), 0)
  assert.equal(compareDecimal("-0.00", "0"), 0)
  assert.equal(compareDecimal("0.001", "0"), 1)
  assert.equal(compareDecimal("-0.0001", "0"), -1)
  assert.equal(compareDecimal("007.5", "7.50"), 0)
  assert.equal(compareDecimal("-2", "-1.9999"), -1)
  assert.equal(compareDecimal("90071992547409.93", "90071992547409.92"), 1)
  assert.equal(compareDecimal("abc", "0"), undefined)
  assert.equal(compareDecimal("0", " 0"), undefined)
})

void test("a canonical decimal is exactly what formatDecimal writes at that scale", () => {
  for (const [value, scale] of [["0.00", 2], ["-0.05", 2], ["12.30", 2], ["-90071992547409.93", 2], ["2.5000", 4], ["0", 0], ["-42", 0]] as const) {
    assert.equal(isCanonicalDecimal(value, scale), true, `${value} @ ${String(scale)}`)
  }
  for (const [value, scale] of [["-0.00", 2], ["-0", 0], ["01.00", 2], ["-02.0000", 4], ["1", 2], ["1.0", 2], ["1.000", 2],
    ["2.50", 4], [" 1.00", 2], ["+1.00", 2], ["--1.00", 2], [".50", 2], ["1.00\n", 2], ["", 0]] as const) {
    assert.equal(isCanonicalDecimal(value, scale), false, `${JSON.stringify(value)} @ ${String(scale)}`)
  }
})
