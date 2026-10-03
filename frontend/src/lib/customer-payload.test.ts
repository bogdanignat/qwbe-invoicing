import assert from "node:assert/strict"
import test from "node:test"

import { customerPayload, identifierMaxLength, type CustomerField } from "./customer-payload.ts"
import { newCustomerForm, type CustomerForm } from "./customer-form.ts"

const company: CustomerForm = {
  ...newCustomerForm(),
  name: " Acme SRL ", fiscalIdentifier: "RO12345674", vatRegistered: true,
  city: " Iași ", street: " Str. Scurtă 2 ", county: "RO-IS", postalCode: " 700001 ",
  defaultPaymentTermDays: "30",
}

void test("a company becomes a Romanian address with a normalized CUI", () => {
  assert.deepEqual(customerPayload(company), {
    kind: "ready",
    payload: {
      partyType: "company", name: "Acme SRL", fiscalIdentifier: "12345674", vatRegistered: true,
      address: { countryCode: "RO", city: "Iași", street: "Str. Scurtă 2", county: "RO-IS", postalCode: "700001" },
      defaultPaymentTermDays: 30,
    },
  })
})

void test("what is absent stays absent, and only Bucharest carries a sector", () => {
  const bare = customerPayload({ ...company, postalCode: " ", defaultPaymentTermDays: "" })
  assert.equal(bare.kind === "ready" && "defaultPaymentTermDays" in bare.payload, false)
  assert.equal(bare.kind === "ready" && "postalCode" in bare.payload.address, false)
  // A stale sector typed under Bucharest is not sent with a county that has none.
  const iasi = customerPayload({ ...company, sector: "3" })
  assert.equal(iasi.kind === "ready" && "sector" in iasi.payload.address, false)
  const bucharest = customerPayload({ ...company, county: "RO-B", sector: "3" })
  assert.equal(bucharest.kind === "ready" && bucharest.payload.address.sector, 3)
  // An individual is never registered for VAT, whatever the flag held.
  const person = customerPayload({ ...company, partyType: "individual", fiscalIdentifier: "1950101070017" })
  assert.equal(person.kind === "ready" && person.payload.vatRegistered, false)
  assert.equal(person.kind === "ready" && person.payload.fiscalIdentifier, "1950101070017")
  // A CNP is optional: an individual may be recorded by name and address alone.
  assert.equal(customerPayload({ ...company, partyType: "individual", fiscalIdentifier: "" }).kind, "ready")
})

void test("the first wrong field refuses, reading down the form", () => {
  const refusals: ReadonlyArray<readonly [Partial<CustomerForm>, CustomerField]> = [
    [{ name: "  " }, "name"],
    [{ fiscalIdentifier: "" }, "fiscalIdentifier"],
    [{ fiscalIdentifier: "0123" }, "fiscalIdentifier"],
    [{ fiscalIdentifier: "1" }, "fiscalIdentifier"],
    [{ fiscalIdentifier: "12345678901" }, "fiscalIdentifier"],
    [{ partyType: "individual", fiscalIdentifier: "195010107001" }, "fiscalIdentifier"],
    [{ city: " " }, "city"],
    [{ street: " " }, "street"],
    [{ county: "" }, "county"],
    [{ county: "RO-XX" }, "county"],
    [{ county: "RO-B", sector: "" }, "sector"],
    [{ county: "RO-B", sector: "0" }, "sector"],
    [{ county: "RO-B", sector: "7" }, "sector"],
    [{ defaultPaymentTermDays: "-1" }, "defaultPaymentTermDays"],
    [{ defaultPaymentTermDays: "2.5" }, "defaultPaymentTermDays"],
    [{ defaultPaymentTermDays: "3651" }, "defaultPaymentTermDays"],
    [{ defaultPaymentTermDays: "curând" }, "defaultPaymentTermDays"],
    // Name first: a form wrong in two places sends the user to the top one.
    [{ name: "", county: "RO-XX" }, "name"],
  ]
  for (const [patch, field] of refusals) {
    const validation = customerPayload({ ...company, ...patch })
    assert.equal(validation.kind, "issue", JSON.stringify(patch))
    assert.equal(validation.field, field, JSON.stringify(patch))
    assert.notEqual(validation.message, "")
  }
  for (const sector of ["1", "6"]) {
    assert.equal(customerPayload({ ...company, county: "RO-B", sector }).kind, "ready")
  }
  for (const days of ["0", "3650"]) {
    assert.equal(customerPayload({ ...company, defaultPaymentTermDays: days }).kind, "ready")
  }
})

// The native attribute is the first line of defence and the pure rules are the
// source: a cap shorter than what the rules accept would cut a valid
// identifier before it was ever validated.
void test("the native identifier cap admits every identifier the rules accept", () => {
  const longestCui = `1${"0".repeat(9)}`
  assert.equal(customerPayload({ ...company, fiscalIdentifier: longestCui }).kind, "ready")
  assert.equal(identifierMaxLength("company"), longestCui.length + "RO".length)
  // A pasted prefix survives the cap, because it is stripped on the next change
  // rather than truncated away here.
  assert.equal(identifierMaxLength("company") >= `RO${longestCui}`.length, true)
  const cnp = "1950101070012"
  assert.equal(customerPayload({ ...company, partyType: "individual", fiscalIdentifier: cnp }).kind, "ready")
  assert.equal(identifierMaxLength("individual"), cnp.length)
  // And it refuses one digit more, so the cap is not wider than the rule either.
  assert.equal(customerPayload({ ...company, fiscalIdentifier: `${longestCui}0` }).kind, "issue")
  assert.equal(customerPayload({ ...company, partyType: "individual", fiscalIdentifier: `${cnp}0` }).kind, "issue")
})
