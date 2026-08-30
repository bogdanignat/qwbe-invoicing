import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../contracts/failures.ts"
import { resolveTaxConfiguration, validateDate, validateIssuer } from "./validation.ts"

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

void test("resolves exactly one effective-dated issuer tax configuration", () => {
  const issuer = {
    organizationId: "org-1",
    legalName: "Exemplu SRL",
    taxIdentifier: "RO12345678",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    defaultSeries: "QWBE",
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

void test("rejects overlapping effective ranges for the same tax code", () => {
  const base = {
    organizationId: "org-1",
    legalName: "Exemplu SRL",
    taxIdentifier: "RO12345678",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    defaultSeries: "QWBE",
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
  assert.doesNotThrow(() => { validateIssuer({
    ...base,
    taxConfigurations: [
      { code: "RO_STANDARD", category: "standard", rate: "19", effectiveFrom: "2020-01-01", effectiveTo: "2025-07-31" },
      { code: "RO_STANDARD", category: "standard", rate: "21", effectiveFrom: "2025-08-01" },
    ],
  }) })
})
