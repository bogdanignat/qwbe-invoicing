import assert from "node:assert/strict"
import test from "node:test"

import {
  chooseCustomerCounty, customerFormOf, customerSectorRequired, newCustomerForm,
  normalizeCustomerIdentifier, switchCustomerPartyType,
} from "./customer-form.ts"
import type { Customer } from "./draft-models.ts"

const customer: Customer = {
  id: "cus_1", organizationId: "org_1", partyType: "company", name: "Acme SRL",
  fiscalIdentifier: "12345674", vatRegistered: true,
  address: { countryCode: "RO", city: "București", street: "Str. Lungă 1", county: "RO-B", sector: 3, postalCode: "010101" },
  defaultPaymentTermDays: 30,
}

void test("the editor opens on a company and fills from what was saved", () => {
  assert.deepEqual(newCustomerForm(), {
    partyType: "company", name: "", fiscalIdentifier: "", vatRegistered: false, city: "", street: "",
    county: "", sector: "", postalCode: "", defaultPaymentTermDays: "",
  })
  assert.deepEqual(customerFormOf(customer), {
    partyType: "company", name: "Acme SRL", fiscalIdentifier: "12345674", vatRegistered: true,
    city: "București", street: "Str. Lungă 1", county: "RO-B", sector: "3", postalCode: "010101",
    defaultPaymentTermDays: "30",
  })
  // Absent is the empty field, not a zero term or a sector 0.
  assert.deepEqual(customerFormOf({
    id: "cus_2", organizationId: "org_1", partyType: "company", name: "Acme SRL",
    fiscalIdentifier: "12345674", vatRegistered: true,
    address: { countryCode: "RO", city: "Iași", street: "Str. Scurtă 2", county: "RO-IS" },
  }), {
    partyType: "company", name: "Acme SRL", fiscalIdentifier: "12345674", vatRegistered: true,
    city: "Iași", street: "Str. Scurtă 2", county: "RO-IS", sector: "", postalCode: "",
    defaultPaymentTermDays: "",
  })
})

void test("the identifier is normalized per party type", () => {
  assert.equal(normalizeCustomerIdentifier("company", " ro 12345674 "), "12345674")
  assert.equal(normalizeCustomerIdentifier("individual", "1 950 101 070 017"), "1950101070017")
})

void test("switching to an individual drops the CUI prefix and the VAT flag", () => {
  const company = { ...customerFormOf(customer), fiscalIdentifier: "RO12345674" }
  assert.deepEqual(switchCustomerPartyType(company, "individual"), {
    ...company, partyType: "individual", fiscalIdentifier: "12345674", vatRegistered: false,
  })
  assert.equal(switchCustomerPartyType(company, "company").vatRegistered, true)
})

void test("a sector belongs to Bucharest alone and is dropped with the county", () => {
  const bucharest = customerFormOf(customer)
  assert.equal(customerSectorRequired(bucharest), true)
  assert.equal(chooseCustomerCounty(bucharest, "RO-B").sector, "3")
  assert.equal(chooseCustomerCounty(bucharest, "RO-IS").sector, "")
  assert.equal(customerSectorRequired(chooseCustomerCounty(bucharest, "RO-IS")), false)
  assert.equal(customerSectorRequired(newCustomerForm()), false)
})
