import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../../contracts/failures.ts"
import { ROMANIAN_COUNTIES, validateBuyer, validateParty } from "../index.ts"

void test("validates Romanian CUI and country for a fiscal party", () => {
  const party = {
    name: "Exemplu SRL",
    fiscalIdentifier: "45561046",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1", county: "RO-BT" },
  }
  const hasIssue = (expected: string) => (error: unknown): boolean =>
    error instanceof ValidationFailure && error.issues.includes(expected)
  assert.doesNotThrow(() => { validateParty(party) })
  for (const fiscalIdentifier of ["19", "60", "12340", "12345674", "1234567897"]) {
    assert.doesNotThrow(() => { validateParty({ ...party, fiscalIdentifier }) })
  }
  assert.doesNotThrow(() => { validateParty({ ...party, fiscalIdentifier: "" }) })
  for (const fiscalIdentifier of ["12345678", "RO45561046", "ro45561046", "045561046", " 45561046 "]) {
    assert.throws(() => { validateParty({ ...party, fiscalIdentifier }) }, hasIssue("fiscalIdentifier must be a valid Romanian CUI"))
  }
  assert.throws(() => { validateParty({ ...party, address: { ...party.address, countryCode: "DE" } }) }, hasIssue("address.countryCode must be RO"))
})

void test("validates explicit buyer type with optional CUI or CNP semantics", () => {
  const address = { countryCode: "RO", city: "Iași", street: "Strada Mică 2", county: "RO-IS" }
  assert.throws(
    () => { validateBuyer({ partyType: "company", name: "Client SRL", fiscalIdentifier: "", vatRegistered: false, address }) },
    (error: unknown) => error instanceof ValidationFailure && error.issues.includes("fiscalIdentifier is required for company"),
  )
  assert.doesNotThrow(() => { validateBuyer({ partyType: "individual", name: "Ion Popescu", fiscalIdentifier: "", vatRegistered: false, address }) })
  assert.doesNotThrow(() => { validateBuyer({ partyType: "individual", name: "Ion Popescu", fiscalIdentifier: "1800101221144", vatRegistered: false, address }) })
  assert.doesNotThrow(() => { validateBuyer({ partyType: "company", name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true, address }) })
  assert.doesNotThrow(() => { validateBuyer({ partyType: "company", name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: false, address }) })
  assert.throws(
    () => { validateBuyer({ partyType: "individual", name: "Ion Popescu", fiscalIdentifier: "", vatRegistered: true, address }) },
    (error: unknown) => error instanceof ValidationFailure && error.issues.includes("vatRegistered must be false for individual"),
  )
  assert.throws(
    () => { validateBuyer({ partyType: "individual", name: "Ion Popescu", fiscalIdentifier: "1800101221145", vatRegistered: false, address }) },
    (error: unknown) => error instanceof ValidationFailure && error.issues.includes("fiscalIdentifier must be a valid Romanian CNP"),
  )
  assert.throws(
    () => { validateBuyer({ partyType: "person" as never, name: "Ion Popescu", fiscalIdentifier: "", vatRegistered: false, address }) },
    (error: unknown) => error instanceof ValidationFailure && error.issues.includes("partyType must be company or individual"),
  )
})

void test("publishes all ISO Romanian counties and validates county-sector coupling", () => {
  assert.equal(ROMANIAN_COUNTIES.length, 42)
  assert.equal(new Set(ROMANIAN_COUNTIES.map(({ code }) => code)).size, 42)
  assert.deepEqual(new Set(ROMANIAN_COUNTIES.map(({ code }) => code)), new Set([
    "RO-AB", "RO-AR", "RO-AG", "RO-BC", "RO-BH", "RO-BN", "RO-BT", "RO-BV", "RO-BR", "RO-BZ", "RO-CS",
    "RO-CL", "RO-CJ", "RO-CT", "RO-CV", "RO-DB", "RO-DJ", "RO-GL", "RO-GR", "RO-GJ", "RO-HR", "RO-HD",
    "RO-IL", "RO-IS", "RO-IF", "RO-MM", "RO-MH", "RO-MS", "RO-NT", "RO-OT", "RO-PH", "RO-SM", "RO-SJ",
    "RO-SB", "RO-SV", "RO-TR", "RO-TM", "RO-TL", "RO-VS", "RO-VL", "RO-VN", "RO-B",
  ]))
  const party = { name: "Exemplu SRL", fiscalIdentifier: "12345674",
    address: { countryCode: "RO", city: "București", street: "Strada 1", county: "RO-B", sector: 1 } }
  for (let sector = 1; sector <= 6; sector += 1) {
    assert.doesNotThrow(() => { validateParty({ ...party, address: { ...party.address, sector } }) })
  }
  assert.throws(() => { validateParty({ ...party, address: { ...party.address, sector: 7 } }) }, ValidationFailure)
  const withoutSector = { countryCode: "RO", city: "București", street: "Strada 1", county: "RO-B" }
  assert.throws(() => { validateParty({ ...party, address: withoutSector }) }, ValidationFailure)
  assert.throws(() => { validateParty({ ...party, address: { ...party.address, county: "RO-IS" } }) }, ValidationFailure)
  assert.throws(() => { validateParty({ ...party, address: { ...withoutSector, county: "Iași" } }) }, ValidationFailure)
})
