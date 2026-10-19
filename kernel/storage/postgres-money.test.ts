import assert from "node:assert/strict"
import test from "node:test"

import { money, moneyFrom, moneyValue, optionalMoney, optionalMoneyValue } from "./postgres-money.ts"

/** The codec on its own: pure digit work, so no cluster is needed here. */

void test("money becomes the int8 value in bani and comes back unchanged", () => {
  for (const [decimal, minor] of [
    ["0.00", "0"], ["0.05", "5"], ["-0.05", "-5"], ["1.00", "100"], ["123.45", "12345"], ["-123.45", "-12345"],
    ["90071992547409.93", "9007199254740993"],
    ["92233720368547758.07", "9223372036854775807"], ["-92233720368547758.08", "-9223372036854775808"],
  ] as const) {
    assert.equal(moneyValue(decimal), minor, decimal)
    assert.equal(moneyFrom(minor), decimal, minor)
  }
})

void test("negative zero is zero in both directions", () => {
  assert.equal(moneyValue("-0.00"), "0")
  assert.equal(moneyFrom("-0"), "0.00")
})

void test("the writer refuses anything but the canonical two-decimal form", () => {
  for (const input of [
    "", "1", "1.0", "1.000", "1.5", " 1.00", "1.00 ", "+1.00", "01.00", "-01.00", "1e2", "1,00", ".50", "-.50",
    "NaN", "Infinity", "0x10", "1.00\n", "١.٠٠",
  ]) assert.throws(() => moneyValue(input), /invalid money amount/u, JSON.stringify(input))
})

void test("the reader takes only the driver's int8 string", () => {
  for (const input of ["", "1.5", " 1", "1e3", "--1", "+1", "0x1"]) {
    assert.throws(() => moneyFrom(input), /invalid money minor units/u, JSON.stringify(input))
  }
  assert.throws(() => money({ amount: 12345 }, "amount"), /invalid amount/u)
  assert.throws(() => money({ amount: null }, "amount"), /invalid amount/u)
  assert.throws(() => money({}, "amount"), /invalid amount/u)
})

void test("an absent capital is NULL, and zero stays a real zero", () => {
  assert.equal(optionalMoneyValue(""), null)
  assert.equal(optionalMoneyValue("0.00"), "0")
  assert.equal(optionalMoneyValue("1000.00"), "100000")
  assert.equal(optionalMoney({ capital: null }, "capital"), "")
  assert.equal(optionalMoney({ capital: "0" }, "capital"), "0.00")
  assert.throws(() => optionalMoney({}, "capital"), /invalid capital/u)
  assert.throws(() => optionalMoney({ capital: "" }, "capital"), /invalid money minor units/u)
})
