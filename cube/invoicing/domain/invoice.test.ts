import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../contracts/failures.ts"
import { validateDate, validateDocumentSeries } from "./validation.ts"
import { resolveVatConfiguration, validateIssuer } from "../registry/index.ts"

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
