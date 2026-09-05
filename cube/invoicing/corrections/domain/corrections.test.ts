import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../../contracts/failures.ts"
import { negateMoney, validateCreateCorrectionInput } from "./corrections.ts"

void test("negates money amounts symmetrically", () => {
  assert.equal(negateMoney("151.25"), "-151.25")
  assert.equal(negateMoney("-151.25"), "151.25")
  assert.equal(negateMoney("0.00"), "-0.00")
})

void test("validates correction input: original invoice, reason length and calendar date", () => {
  const hasIssue = (expected: string) => (error: unknown): boolean =>
    error instanceof ValidationFailure && error.issues.includes(expected)
  assert.doesNotThrow(() => { validateCreateCorrectionInput({ originalInvoiceId: "inv-1", reason: "Eroare de cantitate" }) })
  assert.doesNotThrow(() => { validateCreateCorrectionInput({ originalInvoiceId: "inv-1", reason: "Storno", issueDate: "2028-02-29" }) })
  assert.throws(() => { validateCreateCorrectionInput({ originalInvoiceId: " ", reason: "Storno" }) }, hasIssue("originalInvoiceId is required"))
  assert.throws(() => { validateCreateCorrectionInput({ originalInvoiceId: "inv-1", reason: "  " }) }, hasIssue("reason is required"))
  assert.throws(() => { validateCreateCorrectionInput({ originalInvoiceId: "inv-1", reason: "x".repeat(501) }) }, hasIssue("reason must be at most 500 characters"))
  assert.throws(() => { validateCreateCorrectionInput({ originalInvoiceId: "inv-1", reason: "Storno", issueDate: "2026/09/01" }) }, hasIssue("issueDate must be YYYY-MM-DD"))
  assert.throws(() => { validateCreateCorrectionInput({ originalInvoiceId: "inv-1", reason: "Storno", issueDate: "2027-02-29" }) }, hasIssue("issueDate must be a valid calendar date"))
})
