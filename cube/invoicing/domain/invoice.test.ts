import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../contracts/failures.ts"
import { resolveTaxConfiguration, validateBuyer, validateCustomer, validateDate, validateDocumentSeries, validateIssuer, validateParty } from "./validation.ts"

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

void test("validates Romanian CUI, country, and issuer currency", () => {
  const party = {
    legalName: "Exemplu SRL",
    taxIdentifier: "45561046",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
  }
  const hasIssue = (expected: string) => (error: unknown): boolean =>
    error instanceof ValidationFailure && error.issues.includes(expected)
  assert.doesNotThrow(() => { validateParty(party) })
  for (const taxIdentifier of ["19", "60", "12340", "RO12345674", "1234567897"]) {
    assert.doesNotThrow(() => { validateParty({ ...party, taxIdentifier }) })
  }
  assert.doesNotThrow(() => { validateParty({ ...party, taxIdentifier: "" }) })
  for (const taxIdentifier of ["12345678", "ro45561046", "045561046", " 45561046 "]) {
    assert.throws(() => { validateParty({ ...party, taxIdentifier }) }, hasIssue("taxIdentifier must be a valid Romanian CUI"))
  }
  assert.throws(() => { validateParty({ ...party, address: { ...party.address, countryCode: "DE" } }) }, hasIssue("address.countryCode must be RO"))
  const issuer = {
    ...party,
    organizationId: "org-1",
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    taxConfigurations: [{ code: "RO_NON_VAT", category: "standard" as const, rate: "0", effectiveFrom: "2026-01-01" }],
  }
  assert.throws(() => { validateIssuer({ ...issuer, taxIdentifier: "" }) }, hasIssue("taxIdentifier must be a valid Romanian CUI"))
  assert.throws(() => { validateIssuer({ ...issuer, defaultCurrency: "EUR" }) }, hasIssue("defaultCurrency must be RON"))
  assert.throws(() => { validateIssuer({
    ...issuer,
    taxConfigurations: [{ code: "RO_STANDARD", category: "standard", rate: "21", effectiveFrom: "2026-01-01" }],
  }) }, hasIssue("taxIdentifier without RO prefix requires RO_NON_VAT with rate 0"))
  assert.throws(() => { validateIssuer({
    ...issuer,
    taxIdentifier: "RO45561046",
  }) }, hasIssue("taxIdentifier with RO prefix requires a VAT-registered tax configuration"))
  assert.throws(() => { validateIssuer({
    ...issuer,
    taxIdentifier: "RO45561046",
    taxConfigurations: [{ code: "RO_NON_VAT", category: "standard", rate: "21", effectiveFrom: "2026-01-01" }],
  }) }, hasIssue("tax configuration RO_NON_VAT rate must be 0"))
  assert.throws(() => { validateIssuer({
    ...issuer,
    taxIdentifier: "RO45561046",
    taxConfigurations: [
      { code: "RO_STANDARD", category: "standard", rate: "21", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" },
      { code: "RO_NON_VAT", category: "standard", rate: "0", effectiveFrom: "2027-01-01" },
    ],
  }) }, hasIssue("taxIdentifier with RO prefix requires a VAT-registered tax configuration"))
  assert.doesNotThrow(() => { validateIssuer({
    ...issuer,
    taxIdentifier: "RO45561046",
    taxConfigurations: [{ code: "RO_REDUCED", category: "standard", rate: "11", effectiveFrom: "2026-01-01" }],
  }) })
})

void test("validates explicit buyer type with optional CUI or CNP semantics", () => {
  const address = { countryCode: "RO", city: "Iași", street: "Strada Mică 2" }
  assert.throws(
    () => { validateBuyer({ partyType: "company", legalName: "Client SRL", taxIdentifier: "", address }) },
    (error: unknown) => error instanceof ValidationFailure && error.issues.includes("taxIdentifier is required for company"),
  )
  assert.doesNotThrow(() => { validateBuyer({ partyType: "individual", legalName: "Ion Popescu", taxIdentifier: "", address }) })
  assert.doesNotThrow(() => { validateBuyer({ partyType: "individual", legalName: "Ion Popescu", taxIdentifier: "1800101221144", address }) })
  assert.throws(
    () => { validateBuyer({ partyType: "individual", legalName: "Ion Popescu", taxIdentifier: "1800101221145", address }) },
    (error: unknown) => error instanceof ValidationFailure && error.issues.includes("taxIdentifier must be a valid Romanian CNP"),
  )
  assert.throws(
    () => { validateBuyer({ partyType: "person" as never, legalName: "Ion Popescu", taxIdentifier: "", address }) },
    (error: unknown) => error instanceof ValidationFailure && error.issues.includes("partyType must be company or individual"),
  )
})

void test("resolves exactly one effective-dated issuer tax configuration", () => {
  const issuer = {
    organizationId: "org-1",
    legalName: "Exemplu SRL",
    taxIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    taxConfigurations: [
      { code: "RO_STANDARD", category: "standard" as const, rate: "19.00", effectiveFrom: "2020-01-01", effectiveTo: "2025-07-31" },
      { code: "RO_STANDARD", category: "standard" as const, rate: "21.00", effectiveFrom: "2025-08-01" },
    ],
  }
  validateIssuer(issuer)
  assert.equal(resolveTaxConfiguration(issuer, "RO_STANDARD", "2025-07-31").rate, "19.00")
  assert.equal(resolveTaxConfiguration(issuer, "RO_STANDARD", "2025-08-01").rate, "21.00")
  assert.throws(
    () => resolveTaxConfiguration(issuer, "UNKNOWN", "2026-01-01"),
    (error: unknown) => error instanceof ValidationFailure,
  )
})

void test("bounds customer payment terms to a practical calendar range", () => {
  const customer = { partyType: "individual" as const, legalName: "Ana Pop", taxIdentifier: "", address: {
    countryCode: "RO", city: "Botoșani", street: "Strada 1",
  } }
  assert.doesNotThrow(() => { validateCustomer({ ...customer, defaultPaymentTermDays: 3650 }) })
  assert.throws(() => { validateCustomer({ ...customer, defaultPaymentTermDays: 3651 }) },
    (error: unknown) => error instanceof ValidationFailure
      && error.issues.includes("defaultPaymentTermDays must be an integer between 0 and 3650"))
})

void test("rejects overlapping effective ranges for the same tax code", () => {
  const base = {
    organizationId: "org-1",
    legalName: "Exemplu SRL",
    taxIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
  }
  assert.throws(() => { validateIssuer({
    ...base,
    taxConfigurations: [
      { code: "RO_STANDARD", category: "standard", rate: "19", effectiveFrom: "2020-01-01", effectiveTo: "2025-08-01" },
      { code: "RO_STANDARD", category: "standard", rate: "21", effectiveFrom: "2025-08-01" },
    ],
  }) }, (error: unknown) => error instanceof ValidationFailure)
  assert.throws(() => { validateIssuer({
    ...base,
    taxConfigurations: [
      { code: "RO_STANDARD", category: "standard", rate: "19", effectiveFrom: "2020-01-01" },
      { code: "RO_STANDARD", category: "standard", rate: "21", effectiveFrom: "2025-08-01" },
    ],
  }) }, (error: unknown) => error instanceof ValidationFailure)
  assert.throws(() => { validateIssuer({
    ...base,
    taxConfigurations: [
      { code: "RO_STANDARD", category: "standard", rate: "21", effectiveFrom: "2025-08-01" },
      { code: "RO_NON_VAT", category: "standard", rate: "0", effectiveFrom: "2026-01-01" },
    ],
  }) }, (error: unknown) => error instanceof ValidationFailure)
  assert.doesNotThrow(() => { validateIssuer({
    ...base,
    taxConfigurations: [
      { code: "RO_STANDARD", category: "standard", rate: "19", effectiveFrom: "2020-01-01", effectiveTo: "2025-07-31" },
      { code: "RO_STANDARD", category: "standard", rate: "21", effectiveFrom: "2025-08-01" },
    ],
  }) })
})
