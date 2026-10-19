import assert from "node:assert/strict"
import test from "node:test"

import { comboboxInputAria, comboboxInputAttributes, comboboxKey, comboboxOptionAria, comboboxOptionId } from "./combobox.ts"

void test("arrows move through the options and wrap; nothing moves in an empty list", () => {
  assert.deepEqual(comboboxKey("ArrowDown", -1, 3), { kind: "move", index: 0 })
  assert.deepEqual(comboboxKey("ArrowDown", 1, 3), { kind: "move", index: 2 })
  assert.deepEqual(comboboxKey("ArrowDown", 2, 3), { kind: "move", index: 0 })
  assert.deepEqual(comboboxKey("ArrowUp", -1, 3), { kind: "move", index: 2 })
  assert.deepEqual(comboboxKey("ArrowUp", 0, 3), { kind: "move", index: 2 })
  assert.deepEqual(comboboxKey("ArrowUp", 2, 3), { kind: "move", index: 1 })
  assert.deepEqual(comboboxKey("ArrowDown", -1, 0), { kind: "none" })
  assert.deepEqual(comboboxKey("Escape", -1, 0), { kind: "none" }, "a closed list leaves Escape to the page")
})

void test("Enter picks only an active option, Escape closes, other keys stay the input's", () => {
  assert.deepEqual(comboboxKey("Enter", 1, 3), { kind: "pick", index: 1 })
  assert.deepEqual(comboboxKey("Enter", -1, 3), { kind: "none" }, "no active option: Enter submits the form as usual")
  assert.deepEqual(comboboxKey("Escape", 1, 3), { kind: "close" })
  for (const key of ["a", "Home", "End", "Tab", "ArrowLeft", " "]) assert.deepEqual(comboboxKey(key, 1, 3), { kind: "none" }, key)
})

void test("the input is a combobox that controls the listbox and points at the active option", () => {
  assert.deepEqual(comboboxInputAria("list", 0, -1), {
    role: "combobox", "aria-autocomplete": "list", "aria-expanded": false, "aria-controls": "list", "aria-activedescendant": undefined,
  })
  assert.deepEqual(comboboxInputAria("list", 3, -1)["aria-expanded"], true)
  assert.equal(comboboxInputAria("list", 3, 2)["aria-activedescendant"], comboboxOptionId("list", 2))
  assert.equal(comboboxInputAria("list", 2, 5)["aria-activedescendant"], undefined, "a stale index points nowhere")
})

void test("each option has its own id, and only the active one is selected", () => {
  assert.deepEqual(comboboxOptionAria("list", 1, 1), { id: "list-option-1", role: "option", "aria-selected": true })
  assert.deepEqual(comboboxOptionAria("list", 0, 1), { id: "list-option-0", role: "option", "aria-selected": false })
  assert.notEqual(comboboxOptionId("list", 0), comboboxOptionId("list", 1))
})

void test("only a suggesting input is a combobox; otherwise it is a plain text input, with the browser's autofill as before", () => {
  assert.deepEqual(comboboxInputAttributes(false, "list", 0, -1), {})
  assert.deepEqual(comboboxInputAttributes(false, "list", 3, 1), {}, "suggestions left over from before are not announced either")
  assert.deepEqual(comboboxInputAttributes(true, "list", 0, -1), { ...comboboxInputAria("list", 0, -1), autoComplete: "off" })
  assert.deepEqual(comboboxInputAttributes(true, "list", 3, 1), { ...comboboxInputAria("list", 3, 1), autoComplete: "off" })
  assert.equal("role" in comboboxInputAttributes(false, "list", 0, -1), false)
})
