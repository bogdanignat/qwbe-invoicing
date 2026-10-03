import assert from "node:assert/strict"
import test from "node:test"

import { ORGANIZATION_TIME_ZONE, money, orDash, todayIn, vatTreatmentLabel } from "./format.ts"

// The day a VAT rate changes is the day the difference shows: in the three
// hours between midnight in Bucharest and midnight in UTC, a browser reading
// its own clock would still offer the withdrawn rate the server refuses.
void test("the date is the organization's, whatever the browser's zone", () => {
  assert.equal(todayIn(ORGANIZATION_TIME_ZONE, new Date("2025-07-31T20:59:59Z")), "2025-07-31")
  assert.equal(todayIn(ORGANIZATION_TIME_ZONE, new Date("2025-07-31T21:00:00Z")), "2025-08-01")
  // The same instant, read in UTC, is still the previous day — which is exactly
  // the answer a `TZ=UTC` machine would have given on its own.
  assert.equal(todayIn("UTC", new Date("2025-07-31T21:00:00Z")), "2025-07-31")
  // Winter: the offset is +2, so the boundary moves with it rather than being
  // a fixed three hours.
  assert.equal(todayIn(ORGANIZATION_TIME_ZONE, new Date("2025-01-31T21:59:59Z")), "2025-01-31")
  assert.equal(todayIn(ORGANIZATION_TIME_ZONE, new Date("2025-01-31T22:00:00Z")), "2025-02-01")
})

void test("the date is always the padded ISO calendar date", () => {
  assert.match(todayIn(ORGANIZATION_TIME_ZONE), /^\d{4}-\d{2}-\d{2}$/u)
  assert.equal(todayIn(ORGANIZATION_TIME_ZONE, new Date("2025-03-05T10:00:00Z")), "2025-03-05")
})

void test("an amount keeps the string the snapshot froze", () => {
  assert.equal(money("1234.50", "RON"), "1234.50 RON")
  assert.equal(orDash(""), "—")
  assert.equal(orDash(undefined), "—")
  assert.equal(orDash("RO12345674"), "RO12345674")
})

void test("an article 310 line is named by its exemption, not by a zero rate", () => {
  assert.equal(vatTreatmentLabel({ vatCategoryCode: "O", rate: "0.00" }), "Scutit TVA — art. 310")
  assert.equal(vatTreatmentLabel({ vatCategoryCode: "S", rate: "21.00" }), "TVA 21.00%")
})
