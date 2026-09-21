import assert from "node:assert/strict"
import test from "node:test"
import { issuerAddressSelection } from "./issuer-address-state.ts"

const saved = { countryCode: "RO", city: "București", street: "Strada 1", county: "RO-B", sector: 2 }

void test("editing only an existing Bucharest issuer's sector overrides the saved address", () => {
  assert.deepEqual(issuerAddressSelection(saved, undefined, undefined), { county: "RO-B", sector: 2 })
  assert.deepEqual(issuerAddressSelection(saved, undefined, 5), { county: "RO-B", sector: 5 })
})

void test("changing county clears saved sector and permits choosing a new Bucharest sector", () => {
  assert.deepEqual(issuerAddressSelection(saved, "RO-IS", undefined), { county: "RO-IS", sector: undefined })
  assert.deepEqual(issuerAddressSelection(saved, "RO-B", undefined), { county: "RO-B", sector: undefined })
  assert.deepEqual(issuerAddressSelection(saved, "RO-B", 6), { county: "RO-B", sector: 6 })
})
