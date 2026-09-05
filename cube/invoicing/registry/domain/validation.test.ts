import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../../contracts/failures.ts"
import { validateParty } from "../../domain/validation.ts"
import { validateCustomer, validateIssuer } from "./validation.ts"

void test("validates Romanian CUI, country, and issuer currency", () => {
  const party = {
    name: "Exemplu SRL",
    fiscalIdentifier: "45561046",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
  }
  const hasIssue = (expected: string) => (error: unknown): boolean =>
    error instanceof ValidationFailure && error.issues.includes(expected)
  assert.doesNotThrow(() => { validateParty(party) })
  for (const fiscalIdentifier of ["19", "60", "12340", "RO12345674", "1234567897"]) {
    assert.doesNotThrow(() => { validateParty({ ...party, fiscalIdentifier }) })
  }
  assert.doesNotThrow(() => { validateParty({ ...party, fiscalIdentifier: "" }) })
  for (const fiscalIdentifier of ["12345678", "ro45561046", "045561046", " 45561046 "]) {
    assert.throws(() => { validateParty({ ...party, fiscalIdentifier }) }, hasIssue("fiscalIdentifier must be a valid Romanian CUI"))
  }
  assert.throws(() => { validateParty({ ...party, address: { ...party.address, countryCode: "DE" } }) }, hasIssue("address.countryCode must be RO"))
  const issuer = {
    ...party,
    organizationId: "org-1",
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    vatConfigurations: [{ code: "RO_NON_VAT", rate: "0", effectiveFrom: "2026-01-01" }],
  }
  assert.throws(() => { validateIssuer({ ...issuer, fiscalIdentifier: "" }) }, hasIssue("fiscalIdentifier must be a valid Romanian CUI"))
  assert.throws(() => { validateIssuer({ ...issuer, defaultCurrency: "EUR" }) }, hasIssue("defaultCurrency must be RON"))
  assert.throws(() => { validateIssuer({
    ...issuer,
    vatConfigurations: [{ code: "RO_STANDARD", rate: "21", effectiveFrom: "2026-01-01" }],
  }) }, hasIssue("fiscalIdentifier without RO prefix requires RO_NON_VAT with rate 0"))
  assert.throws(() => { validateIssuer({
    ...issuer,
    fiscalIdentifier: "RO45561046",
  }) }, hasIssue("fiscalIdentifier with RO prefix requires a VAT-registered vat configuration"))
  assert.throws(() => { validateIssuer({
    ...issuer,
    fiscalIdentifier: "RO45561046",
    vatConfigurations: [{ code: "RO_NON_VAT", rate: "21", effectiveFrom: "2026-01-01" }],
  }) }, hasIssue("vat configuration RO_NON_VAT rate must be 0"))
  assert.throws(() => { validateIssuer({
    ...issuer,
    fiscalIdentifier: "RO45561046",
    vatConfigurations: [
      { code: "RO_STANDARD", rate: "21", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" },
      { code: "RO_NON_VAT", rate: "0", effectiveFrom: "2027-01-01" },
    ],
  }) }, hasIssue("fiscalIdentifier with RO prefix requires a VAT-registered vat configuration"))
  assert.doesNotThrow(() => { validateIssuer({
    ...issuer,
    fiscalIdentifier: "RO45561046",
    vatConfigurations: [{ code: "RO_REDUCED", rate: "11", effectiveFrom: "2026-01-01" }],
  }) })
})

void test("bounds customer payment terms to a practical calendar range", () => {
  const customer = { partyType: "individual" as const, name: "Ana Pop", fiscalIdentifier: "", address: {
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
    name: "Exemplu SRL",
    fiscalIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
  }
  assert.throws(() => { validateIssuer({
    ...base,
    vatConfigurations: [
      { code: "RO_STANDARD", rate: "19", effectiveFrom: "2020-01-01", effectiveTo: "2025-08-01" },
      { code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" },
    ],
  }) }, (error: unknown) => error instanceof ValidationFailure)
  assert.throws(() => { validateIssuer({
    ...base,
    vatConfigurations: [
      { code: "RO_STANDARD", rate: "19", effectiveFrom: "2020-01-01" },
      { code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" },
    ],
  }) }, (error: unknown) => error instanceof ValidationFailure)
  assert.throws(() => { validateIssuer({
    ...base,
    vatConfigurations: [
      { code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" },
      { code: "RO_NON_VAT", rate: "0", effectiveFrom: "2026-01-01" },
    ],
  }) }, (error: unknown) => error instanceof ValidationFailure)
  assert.doesNotThrow(() => { validateIssuer({
    ...base,
    vatConfigurations: [
      { code: "RO_STANDARD", rate: "19", effectiveFrom: "2020-01-01", effectiveTo: "2025-07-31" },
      { code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" },
    ],
  }) })
})
