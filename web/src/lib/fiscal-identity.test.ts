import assert from "node:assert/strict"
import test from "node:test"

import { fiscalIdentity, formattedRomanianAddress, issuerPresentationIdentity } from "./fiscal-identity.ts"

void test("derives VAT presentation from canonical CUI and explicit snapshot state", () => {
  assert.deepEqual(fiscalIdentity({ partyType: "company", fiscalIdentifier: "12345674", vatRegistered: true }), {
    identifierLabel: "CUI / CIF", fiscalIdentifier: "12345674", vatIdentifier: "RO12345674",
  })
  assert.equal(fiscalIdentity({ partyType: "company", fiscalIdentifier: "12345674", vatRegistered: false }).vatIdentifier, null)
  assert.equal(fiscalIdentity({ partyType: "individual", fiscalIdentifier: "", vatRegistered: false }).identifierLabel, "CNP")
})

void test("formats county labels and Bucharest sectors without leaking transport codes", () => {
  assert.equal(formattedRomanianAddress({ countryCode: "RO", city: "București", street: "Strada 1", county: "RO-B", sector: 4 }), "Strada 1, București, București, Sector 4, RO")
  assert.equal(formattedRomanianAddress({ countryCode: "RO", city: "Iași", street: "Strada 2", county: "RO-IS" }), "Strada 2, Iași, Iași, RO")
})

void test("issuer presentation distinguishes the current profile from immutable snapshot status", () => {
  const fiscalIdentifier = "12345674"
  const currentVat = { registered: true, effectiveFrom: "2026-01-01" } as const
  assert.equal(issuerPresentationIdentity({ fiscalIdentifier, currentVat }).vatIdentifier, "RO12345674")
  assert.equal(issuerPresentationIdentity({ fiscalIdentifier, currentVat: null }).vatIdentifier, null)
  const frozenIssuer = { fiscalIdentifier, vatRegistered: false, currentVat }
  assert.equal(issuerPresentationIdentity(frozenIssuer).vatIdentifier, null)
})
