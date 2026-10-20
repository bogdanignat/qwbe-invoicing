import assert from "node:assert/strict"
import test from "node:test"

import { formatAmount, formatRate, money } from "./money.ts"

// Only the labels: the arithmetic is held equal to the cube, and these labels to
// the PDF's, by probes/frontend-cube-parity.test.mjs.

void test("an amount groups thousands with a comma and keeps the scale it came with", () => {
  assert.equal(formatAmount("7"), "7")
  assert.equal(formatAmount("1000"), "1,000")
  assert.equal(formatAmount("999.99"), "999.99")
  assert.equal(formatAmount("1000.00"), "1,000.00")
  assert.equal(formatAmount("6600.00"), "6,600.00")
  assert.equal(formatAmount("-1250000.00"), "-1,250,000.00")
  assert.equal(formatAmount("4800.0000"), "4,800.0000")
  assert.equal(formatAmount("-999.9999"), "-999.9999")
})

void test("zero is never signed, at any scale", () => {
  assert.equal(formatAmount("0.00"), "0.00")
  assert.equal(formatAmount("-0.00"), "0.00")
  assert.equal(formatAmount("-0"), "0")
  assert.equal(formatAmount("-0.0000"), "0.0000")
})

void test("an amount past 2^53 stays exact", () => {
  assert.equal(formatAmount("9007199254740993.0000"), "9,007,199,254,740,993.0000")
  assert.equal(formatAmount("-24851819463866056.53"), "-24,851,819,463,866,056.53")
})

void test("text that is no decimal is shown as it came", () => {
  for (const value of ["", "abc", " 1", "1 ", "+1", "1e3", ".5", "5.", "1,5", "1.2.3"]) {
    assert.equal(formatAmount(value), value, JSON.stringify(value))
  }
})

void test("a VAT rate drops its idle zeros", () => {
  assert.equal(formatRate("21.00"), "21")
  assert.equal(formatRate("21"), "21")
  assert.equal(formatRate("20.50"), "20.5")
  assert.equal(formatRate("0.00"), "0")
  assert.equal(formatRate("100.00"), "100")
})

void test("money appends the currency to the grouped amount", () => {
  assert.equal(money("1234.50", "RON"), "1,234.50 RON")
  assert.equal(money("-1250000.00", "RON"), "-1,250,000.00 RON")
  assert.equal(money("0.00", "RON"), "0.00 RON")
})
