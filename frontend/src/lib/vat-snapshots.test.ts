import assert from "node:assert/strict"
import test from "node:test"

import { vatTreatmentLabel } from "./vat-snapshots.ts"

void test("an article 310 line is named by its exemption, not by a zero rate", () => {
  assert.equal(vatTreatmentLabel({ vatCategoryCode: "O", rate: "0.00" }), "Scutit TVA — art. 310")
  assert.equal(vatTreatmentLabel({ vatCategoryCode: "S", rate: "21.00" }), "TVA 21%")
  assert.equal(vatTreatmentLabel({ vatCategoryCode: "S", rate: "20.50" }), "TVA 20.5%")
})

void test("a draft line names its rate as vatRate and reads the same", () => {
  assert.equal(vatTreatmentLabel({ vatCategoryCode: "S", vatRate: "11.00" }), "TVA 11%")
  assert.equal(vatTreatmentLabel({ vatCategoryCode: "O", vatRate: "0.00" }), "Scutit TVA — art. 310")
})
