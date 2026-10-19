import assert from "node:assert/strict"
import test from "node:test"

import {
  INITIAL_CUSTOM_RANGE, applyCustomRange, chooseCustomRange, customRangeView, editCustomRange,
} from "./custom-range-state.ts"

const search = "status=unpaid"
const applied = { from: "2025-11-01", to: "2026-10-19" }

void test("the inputs show the period on screen until something is typed", () => {
  const view = customRangeView(chooseCustomRange(INITIAL_CUSTOM_RANGE, search), search, applied)
  assert.deepEqual(view, { chosen: true, range: applied, error: undefined })
})

void test("a refused interval is explained, and editing a date withdraws the refusal", () => {
  let state = chooseCustomRange(INITIAL_CUSTOM_RANGE, search)
  state = editCustomRange(state, search, customRangeView(state, search, applied).range, "from", "2026-09-01")
  state = editCustomRange(state, search, customRangeView(state, search, applied).range, "to", "2026-03-31")
  const refused = applyCustomRange(state, search, customRangeView(state, search, applied).range)
  assert.equal(refused.kind, "refused")
  assert.match(customRangeView(refused.state, search, applied).error ?? "", /după/u)

  const corrected = editCustomRange(refused.state, search, customRangeView(refused.state, search, applied).range, "from", "2026-03-01")
  const view = customRangeView(corrected, search, applied)
  assert.equal(view.error, undefined)
  assert.deepEqual(view.range, { from: "2026-03-01", to: "2026-03-31" })
  assert.deepEqual(applyCustomRange(corrected, search, view.range), { kind: "apply", range: { from: "2026-03-01", to: "2026-03-31" } })
})

void test("everything typed or refused stays with its address: Back or another filter leaves it behind", () => {
  const typed = editCustomRange(chooseCustomRange(INITIAL_CUSTOM_RANGE, search), search, applied, "from", "")
  const refused = applyCustomRange(typed, search, customRangeView(typed, search, applied).range)
  assert.equal(refused.kind, "refused")
  assert.deepEqual(customRangeView(refused.state, "", applied), { chosen: false, range: applied, error: undefined })
})
