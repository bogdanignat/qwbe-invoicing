import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../contracts/failures.ts"
import { validateDate, validateDocumentSeries } from "./validation.ts"
import { validateBuyer, validateParty } from "../registry/domain/party-validation.ts"
import { ROMANIAN_COUNTIES } from "../registry/domain/romanian-counties.ts"
import { resolveVatConfiguration, validateIssuer } from "../registry/domain/validation.ts"

void test("validates supported document types and fiscal series format", () => {
  assert.doesNotThrow(() => { validateDocumentSeries({ organizationId: "org-1", documentType: "invoice", series: "QWBE_01" }) })
  assert.doesNotThrow(() => { validateDocumentSeries({ organizationId: "org-1", documentType: "proforma", series: "PRO-F" }) })
  assert.throws(
    () => { validateDocumentSeries({ organizationId: "org-1", documentType: "invoice", series: "lower" }) },
    (error: unknown) => error instanceof ValidationFailure && error.issues.includes("series is invalid"),
  )
  assert.throws(
    () => { validateDocumentSeries({ organizationId: "org-1", documentType: "receipt", series: "R" } as never) },
    (error: unknown) => error instanceof ValidationFailure && error.issues.includes("documentType must be invoice or proforma"),
  )
})

void test("validates calendar dates strictly including leap years", () => {
  assert.doesNotThrow(() => { validateDate("2028-02-29", "issueDate") })
  assert.throws(
    () => { validateDate("2026-02-30", "issueDate") },
    (error: unknown) => error instanceof ValidationFailure,
  )
  assert.throws(
    () => { validateDate("2027-02-29", "issueDate") },
    (error: unknown) => error instanceof ValidationFailure,
  )
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

void test("resolves exactly one effective-dated issuer tax configuration", () => {
  const issuer = {
    organizationId: "org-1",
    name: "Exemplu SRL",
    fiscalIdentifier: "12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1", county: "RO-BT" },
    legalForm: "srl" as const,
    tradeRegistryNumber: "J40/123/2020",
    socialCapital: "200.00",
    iban: "",
    bankName: "",
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    branding: null,
    vatConfigurations: [
      { code: "RO_STANDARD", rate: "19.00", vatCategoryCode: "S" as const, vatExemptionReason: null, effectiveFrom: "2020-01-01", effectiveTo: "2025-07-31" },
      { code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S" as const, vatExemptionReason: null, effectiveFrom: "2025-08-01" },
    ],
  }
  validateIssuer(issuer)
  assert.equal(resolveVatConfiguration(issuer, "RO_STANDARD", "2025-07-31").rate, "19.00")
  assert.equal(resolveVatConfiguration(issuer, "RO_STANDARD", "2025-08-01").rate, "21.00")
  assert.throws(
    () => resolveVatConfiguration(issuer, "UNKNOWN", "2026-01-01"),
    (error: unknown) => error instanceof ValidationFailure,
  )
})
