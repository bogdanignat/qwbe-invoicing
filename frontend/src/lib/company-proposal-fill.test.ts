import assert from "node:assert/strict"
import test from "node:test"

import { decodeProposal, decodeSuggestions } from "./company-lookup-model.ts"
import { customerFill, issuerFill, oneTimeBuyerFill } from "./company-proposal-fill.ts"
import { proposalHeadline, proposalVatLine, proposalWarnings, suggestionLabel } from "./company-proposal-view.ts"
import { newCustomerForm } from "./customer-form.ts"
import { issuerFormOf } from "./issuer-form.ts"
import type { DocumentAuthoringForm } from "./document-authoring-form-model.ts"

// The two shapes the backend answers (cubes/invoicing/company-lookup/domain/proposal.ts).
const anaf = decodeProposal({
  name: "Exemplu Construct SRL", cui: "13548146", vatRegistered: true, tradeRegisterNumber: "J40/1234/2001",
  inactive: false, deregistered: false,
  address: { county: "RO-B", sector: 6, city: "București", street: "Str. Exemplu nr. 1", postalCode: "060787" },
})
const openapi = decodeProposal({
  name: "Exemplu Nord SRL", cui: "14399840", vatRegistered: false, deregistered: true,
  address: { county: "RO-CJ", postalCode: "400001", original: "Cluj-Napoca, Str. Lungă 2" },
})

const typedCustomer = { ...newCustomerForm(), city: "Iași", street: "Str. Veche 3", county: "RO-IS", postalCode: "700001" }

const buyer: DocumentAuthoringForm = {
  buyerMode: "one-time", customerId: "", partyType: "company", name: "", companyTaxIdentifier: "", individualTaxIdentifier: "",
  vatRegistered: false, countryCode: "RO", city: "Iași", street: "Str. Veche 3", county: "RO-IS", sector: undefined, postalCode: "",
  series: "FCT", issueDate: "2026-10-19", dueDate: "2026-11-03", dueDateEdited: false, notes: "",
}

void test("decoding keeps only what arrived; a malformed answer is refused", () => {
  assert.deepEqual(openapi.address, { county: "RO-CJ", postalCode: "400001", original: "Cluj-Napoca, Str. Lungă 2" })
  assert.equal("inactive" in openapi, false)
  assert.throws(() => decodeProposal({ name: "X", cui: 1 }))
  assert.deepEqual(decodeSuggestions({ items: [{ cui: "13548146", name: "Exemplu", county: "RO-B" }] }),
    [{ cui: "13548146", name: "Exemplu", county: "RO-B" }])
})

void test("registry customer: identity, suggested VAT flag and the whole ANAF address, sector included", () => {
  assert.deepEqual(customerFill(typedCustomer, anaf), {
    name: "Exemplu Construct SRL", fiscalIdentifier: "13548146", vatRegistered: true,
    county: "RO-B", sector: "6", city: "București", street: "Str. Exemplu nr. 1", postalCode: "060787",
  })
})

void test("registry customer from openapi.ro: county and postal code only, city and street stay as typed", () => {
  const patch = customerFill({ ...typedCustomer, vatRegistered: true }, openapi)
  assert.deepEqual(patch, {
    name: "Exemplu Nord SRL", fiscalIdentifier: "14399840", vatRegistered: false, county: "RO-CJ", sector: "", postalCode: "400001",
  })
  assert.deepEqual({ ...typedCustomer, ...patch }.street, "Str. Veche 3")
})

void test("the sector follows the county: kept in Bucharest without a proposed one, dropped when moving there", () => {
  const noSector = decodeProposal({ name: "B", cui: "13548146", vatRegistered: false, deregistered: false, address: { county: "RO-B" } })
  assert.equal(customerFill({ ...typedCustomer, county: "RO-B", sector: "3" }, noSector).sector, "3")
  assert.equal(customerFill(typedCustomer, noSector).sector, "")
  assert.equal(oneTimeBuyerFill({ ...buyer, county: "RO-B", sector: 3 }, noSector).sector, 3)
  assert.equal(oneTimeBuyerFill(buyer, noSector).sector, undefined)
})

void test("companies only: an individual customer or buyer is never filled", () => {
  assert.deepEqual(customerFill({ ...typedCustomer, partyType: "individual" }, anaf), {})
  assert.deepEqual(oneTimeBuyerFill({ ...buyer, partyType: "individual" }, anaf), {})
})

void test("one-time buyer: the company CUI field, a numeric sector, the suggested VAT flag", () => {
  assert.deepEqual(oneTimeBuyerFill(buyer, anaf), {
    name: "Exemplu Construct SRL", companyTaxIdentifier: "13548146", vatRegistered: true, county: "RO-B", sector: 6,
    city: "București", street: "Str. Exemplu nr. 1", postalCode: "060787",
  })
  const fromOpenapi = oneTimeBuyerFill(buyer, openapi)
  assert.equal("city" in fromOpenapi || "street" in fromOpenapi, false)
  assert.equal(fromOpenapi.individualTaxIdentifier, undefined)
})

void test("issuer: identity, trade register and address; the VAT regime is never touched", () => {
  const issuer = { ...issuerFormOf(null, { registered: false, effectiveFrom: "2026-01-01" }), tradeRegistryNumber: "J12/1/2020" }
  const patch = issuerFill(issuer, anaf)
  assert.deepEqual(patch, {
    name: "Exemplu Construct SRL", fiscalIdentifier: "13548146", tradeRegistryNumber: "J40/1234/2001",
    county: "RO-B", sector: "6", city: "București", street: "Str. Exemplu nr. 1", postalCode: "060787",
  })
  assert.equal("vatRegistered" in patch || "vatEffectiveFrom" in patch, false)
  const filled = { ...issuer, ...issuerFill(issuer, openapi) }
  assert.equal(filled.tradeRegistryNumber, "J12/1/2020", "a register number the provider does not state is kept")
  assert.deepEqual([filled.vatRegistered, filled.vatEffectiveFrom], [false, "2026-01-01"])
})

void test("the card's words: county name, warnings, VAT suggested or informative", () => {
  assert.equal(proposalHeadline(anaf), "Am găsit: Exemplu Construct SRL, București")
  assert.equal(suggestionLabel({ cui: "1", name: "Exemplu" }), "Exemplu")
  assert.deepEqual(proposalWarnings(anaf), [])
  assert.deepEqual(proposalWarnings(openapi), ["Atenție: firma figurează ca radiată."])
  assert.deepEqual(proposalWarnings({ ...anaf, inactive: true }), ["Atenție: firma este declarată inactivă fiscal."])
  assert.match(proposalVatLine(anaf, "suggested"), /o poți schimba/u)
  assert.match(proposalVatLine(anaf, "informative"), /nu se schimbă/u)
})
