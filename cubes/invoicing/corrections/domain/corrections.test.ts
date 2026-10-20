import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../../contracts/failures.ts"
import { negateDecimal, validateCreateCorrectionInput } from "./corrections.ts"

void test("negates decimals symmetrically and keeps their scale", () => {
  assert.equal(negateDecimal("151.25"), "-151.25")
  assert.equal(negateDecimal("-151.25"), "151.25")
  assert.equal(negateDecimal("0.00"), "0.00")
  assert.equal(negateDecimal("-0.00"), "0.00")
  assert.equal(negateDecimal("1.2500"), "-1.2500")
  assert.equal(negateDecimal("-0.0000"), "0.0000")
  assert.equal(negateDecimal("0.0000"), "0.0000")
  assert.equal(negateDecimal("-2.5000"), "2.5000")
  assert.equal(negateDecimal("0.0001"), "-0.0001")
  assert.equal(negateDecimal("-0.01"), "0.01")
  assert.equal(negateDecimal("90071992547409.93"), "-90071992547409.93")
  assert.equal(negateDecimal("-9007199254740993.0000"), "9007199254740993.0000")
  for (const value of ["0.00", "-0.01", "1.2500", "12193263123451181.22"]) assert.equal(negateDecimal(negateDecimal(value)), value)
})

void test("validates correction input: original invoice, reason length and calendar date", () => {
  const hasIssue = (expected: string) => (error: unknown): boolean =>
    error instanceof ValidationFailure && error.issues.includes(expected)
  assert.doesNotThrow(() => { validateCreateCorrectionInput({ originalInvoiceId: "inv-1", reason: "Eroare de cantitate" }) })
  assert.doesNotThrow(() => { validateCreateCorrectionInput({ originalInvoiceId: "inv-1", reason: "Storno", issueDate: "2028-02-29" }) })
  assert.throws(() => { validateCreateCorrectionInput({ originalInvoiceId: " ", reason: "Storno" }) }, hasIssue("originalInvoiceId is required"))
  assert.throws(() => { validateCreateCorrectionInput({ originalInvoiceId: "inv-1", reason: "  " }) }, hasIssue("reason is required"))
  assert.throws(() => { validateCreateCorrectionInput({ originalInvoiceId: "inv-1", reason: "x".repeat(301) }) }, hasIssue("reason must be at most 300 characters"))
  assert.throws(() => { validateCreateCorrectionInput({ originalInvoiceId: "inv-1", reason: "Storno", issueDate: "2026/09/01" }) }, hasIssue("issueDate must be YYYY-MM-DD"))
  assert.throws(() => { validateCreateCorrectionInput({ originalInvoiceId: "inv-1", reason: "Storno", issueDate: "2027-02-29" }) }, hasIssue("issueDate must be a valid calendar date"))
})
