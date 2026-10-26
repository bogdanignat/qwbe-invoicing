import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../contracts/failures.ts"
import { calendarDate, formatMinor, moneyMinor, validateRecordPaymentInput, validateReversePaymentInput } from "./payments.ts"
import { derivePaymentStatus } from "./settlement.ts"

void test("formats the Romanian calendar day of an instant", () => {
  assert.equal(calendarDate(new Date("2026-09-10T22:30:00.000Z")), "2026-09-11")
  assert.equal(calendarDate(new Date("2026-01-10T22:30:00.000Z")), "2026-01-11")
  assert.equal(calendarDate(new Date("2026-09-10T12:00:00.000Z")), "2026-09-10")
})

void test("an invoice becomes overdue at Romanian midnight, not at UTC midnight", () => {
  const base = { totalIncludingVat: "100.00", dueDate: "2026-09-10", payments: [] }
  assert.equal(derivePaymentStatus({ ...base, now: new Date("2026-09-10T20:00:00.000Z") }), "unpaid")
  assert.equal(derivePaymentStatus({ ...base, now: new Date("2026-09-10T22:30:00.000Z") }), "overdue")
  assert.equal(derivePaymentStatus({ ...base, dueDate: null, now: new Date("2026-09-10T22:30:00.000Z") }), "unpaid")
})

void test("money in bani round-trips with its sign", () => {
  for (const [text, minor] of [["0.00", 0n], ["0.05", 5n], ["-0.05", -5n], ["-12.30", -1230n], ["1234567.89", 123456789n]] as const) {
    assert.equal(moneyMinor(text), minor)
    assert.equal(formatMinor(minor), text)
  }
  assert.equal(moneyMinor("25.5"), 2550n)
  assert.throws(() => moneyMinor("-25.5"))
})

void test("reads a canonical amount signed and trimmed, and anything else as a strictly positive input", () => {
  for (const [text, minor] of [[" -0.05 ", -5n], ["-0.00", 0n], ["007.50", 750n], ["-007.50", -750n], [" 25.5 ", 2550n],
    ["25", 2500n], ["0.5", 50n], ["90071992547409.93", 9007199254740993n]] as const) {
    assert.equal(moneyMinor(text), minor, text)
  }
  const refusal = (value: string): ReadonlyArray<string> => {
    try { moneyMinor(value) } catch (error) { if (error instanceof ValidationFailure) return error.issues }
    return []
  }
  for (const value of ["-25.5", "-1", "1.234", "-1.234", "+1.00", "1e2", ".5", "5.", "abc", ""]) {
    assert.deepEqual(refusal(value), ["money must be a non-negative amount with at most two decimals"], value)
  }
  for (const value of ["0", "0.0", "00"]) assert.deepEqual(refusal(value), ["money must be greater than zero"], value)
  for (const [minor, text] of [[-1n, "-0.01"], [-100n, "-1.00"], [-0n, "0.00"], [9007199254740993n, "90071992547409.93"],
    [-9223372036854775808n, "-92233720368547758.08"]] as const) assert.equal(formatMinor(minor), text)
  assert.equal(formatMinor(moneyMinor(" 007.5 ")), "7.50")
})

void test("a recorded payment amount is trimmed, positive and has at most two decimals, each fault named once", () => {
  const base = { invoiceId: "invoice-1", amount: "10.00", currency: "RON", paymentDate: "2026-09-10", method: "bank_transfer" }
  const issues = (amount: string): ReadonlyArray<string> => {
    try { validateRecordPaymentInput({ ...base, amount }) } catch (error) { if (error instanceof ValidationFailure) return error.issues }
    return []
  }
  for (const amount of [" 25.5 ", "25", "0.01", "007.50"]) assert.deepEqual(issues(amount), [], amount)
  for (const amount of ["0", "0.00", " 0.0 "]) assert.deepEqual(issues(amount), ["amount must be greater than zero"], amount)
  for (const amount of ["-1.00", "-0.00", "1.234", "1.", ".5", "+1", "1e2", "1,00", ""]) {
    assert.deepEqual(issues(amount), ["amount must be a non-negative amount with at most two decimals"], amount)
  }
})

const issuesOf = (validate: () => void): ReadonlyArray<string> => {
  try { validate() } catch (error) { if (error instanceof ValidationFailure) return error.issues }
  return []
}

void test("payment texts are bounded as stored (trimmed) and refuse control characters; only note and reason span lines", () => {
  const base = { invoiceId: "invoice-1", amount: "10.00", currency: "RON", paymentDate: "2026-09-10", method: "bank_transfer" }
  const recorded = (fields: object) => issuesOf(() => { validateRecordPaymentInput({ ...base, ...fields }) })
  const limits = [["method", 50], ["externalReference", 100], ["note", 500]] as const
  for (const [field, maximum] of limits) {
    assert.deepEqual(recorded({ [field]: ` ${"x".repeat(maximum)} ` }), [], field)
    assert.deepEqual(recorded({ [field]: "x".repeat(maximum + 1) }), [`${field} must be at most ${String(maximum)} characters`], field)
    for (const character of ["\u0000", "\u000b", "\u001f", "\u007f", "\u0085", "\u2028", "\u2029", "\ufffe", "\uffff"]) {
      assert.deepEqual(recorded({ [field]: `a${character}b` }), [`${field} must not contain control characters`], `${field} ${character}`)
    }
  }
  assert.deepEqual(recorded({ note: "linia 1\nlinia 2" }), [])
  assert.deepEqual(recorded({ externalReference: "OP\n12" }), ["externalReference must not contain control characters"])
  assert.deepEqual(recorded({ method: "card\tPOS" }), ["method must not contain control characters"])

  const reversed = (reason: string) => issuesOf(() => { validateReversePaymentInput({ invoiceId: "invoice-1", paymentId: "payment-1", reason }) })
  assert.deepEqual(reversed("Încasare dublă\nreturnată"), [])
  assert.deepEqual(reversed("x".repeat(501)), ["reason must be at most 500 characters"])
  assert.deepEqual(reversed("a\u0000b"), ["reason must not contain control characters"])
})
