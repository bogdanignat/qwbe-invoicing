import assert from "node:assert/strict"
import test from "node:test"

import { calendarDate, derivePaymentStatus } from "./payments.ts"

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
