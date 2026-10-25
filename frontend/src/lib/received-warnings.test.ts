import assert from "node:assert/strict"
import test from "node:test"

import { receivedWarningText, warningLabels } from "./received-warnings.ts"

void test("the list has one label per kind of warning, in the order they came", () => {
  assert.deepEqual(warningLabels(["buyer_cif_mismatch", "tax_inclusive_mismatch", "lines_total_mismatch"]),
    ["Cumpărătorul are alt CIF", "Totaluri inconsecvente"])
  assert.deepEqual(warningLabels([]), [])
})

void test("the detail says each warning with the amounts as the server computed them, unrounded", () => {
  assert.equal(receivedWarningText({ code: "lines_total_mismatch", declared: "200.00", computed: "200.005" }),
    "Totaluri inconsecvente: suma liniilor este 200.005, iar totalul declarat al liniilor 200.00.")
  assert.equal(receivedWarningText({ code: "buyer_cif_mismatch", expected: "12345674", found: ["19999927", "J40/1/2020"] }),
    "Cumpărătorul de pe factură nu are CIF-ul firmei (12345674): factura dă 19999927, J40/1/2020.")
  assert.equal(receivedWarningText({ code: "buyer_cif_mismatch", expected: "12345674", found: [] }),
    "Cumpărătorul de pe factură nu are CIF-ul firmei (12345674): factura nu dă niciun identificator.")
})
