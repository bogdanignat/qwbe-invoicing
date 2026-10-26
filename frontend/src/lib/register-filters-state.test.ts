import assert from "node:assert/strict"
import test from "node:test"

import {
  choosePeriod, editCustomRange, initialRegisterFilters, isNarrowed, registerRange, type RegisterFiltersState,
} from "./register-filters-state.ts"

const today = "2026-10-26"
const opened = initialRegisterFilters(50)

/** Types `value` into one end the way a date input reports it: one partial date per keystroke. */
const typeInto = (state: RegisterFiltersState, field: "from" | "to", keystrokes: ReadonlyArray<string>) =>
  keystrokes.reduce((current, value) => editCustomRange(current, field, value), state)

void test("the register opens on the current month with the page size it was given", () => {
  assert.equal(opened.period, "month")
  assert.equal(opened.pageSize, 50)
  assert.deepEqual(registerRange(opened, today), { from: "2026-10-01", to: today })
})

void test("choosing the custom interval starts from the dates on screen; choosing it again keeps the typing", () => {
  const custom = choosePeriod(choosePeriod(opened, "last-month", today), "custom", today)
  assert.deepEqual(custom.typed, { from: "2026-09-01", to: "2026-09-30" })
  assert.deepEqual(registerRange(custom, today), { from: "2026-09-01", to: "2026-09-30" })
  const edited = editCustomRange(custom, "from", "2026-09-10")
  assert.deepEqual(choosePeriod(edited, "custom", today), edited)
  assert.deepEqual(registerRange(choosePeriod(edited, "year", today), today), { from: "2026-01-01", to: today })
})

void test("from Toate the custom interval starts open", () => {
  const custom = choosePeriod(choosePeriod(opened, "all", today), "custom", today)
  assert.deepEqual(registerRange(custom, today), { from: "", to: "" })
})

void test("a year being typed is never applied; the whole date is", () => {
  const custom = choosePeriod(opened, "custom", today)
  const typing = typeInto(custom, "from", ["0002-11-02", "0020-11-02", "0202-11-02"])
  assert.deepEqual(typing.typed, { from: "0202-11-02", to: today })
  assert.deepEqual(registerRange(typing, today), { from: "2026-10-01", to: today })
  const typed = typeInto(typing, "from", ["2026-11-02", "2025-11-02"])
  assert.deepEqual(registerRange(typed, today), { from: "2025-11-02", to: today })
})

void test("a backwards interval keeps asking for the last valid one; clearing an end opens it", () => {
  const custom = choosePeriod(opened, "custom", today)
  const backwards = editCustomRange(custom, "from", "2026-10-27")
  assert.deepEqual(backwards.typed, { from: "2026-10-27", to: today })
  assert.deepEqual(registerRange(backwards, today), { from: "2026-10-01", to: today })
  const open = editCustomRange(backwards, "to", "")
  assert.deepEqual(registerRange(open, today), { from: "2026-10-27", to: "" })
})

void test("only Toate with both kinds and no search is the whole register", () => {
  assert.equal(isNarrowed(registerRange(choosePeriod(opened, "all", today), today), "all", ""), false)
  assert.equal(isNarrowed({ from: "", to: "" }, "all", "   "), false)
  assert.equal(isNarrowed({ from: "", to: "" }, "invoice", ""), true)
  assert.equal(isNarrowed({ from: "", to: "" }, "all", "FCT"), true)
  assert.equal(isNarrowed(registerRange(opened, today), "all", ""), true)
})
