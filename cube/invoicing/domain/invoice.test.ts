import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../contracts/failures.ts"
import { resolveVatConfiguration, validateBuyer, validateDate, validateDocumentSeries } from "./validation.ts"
import { validateIssuer } from "../registry/domain/validation.ts"

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
  const address = { countryCode: "RO", city: "Iași", street: "Strada Mică 2" }
  assert.throws(
    () => { validateBuyer({ partyType: "company", name: "Client SRL", fiscalIdentifier: "", address }) },
    (error: unknown) => error instanceof ValidationFailure && error.issues.includes("fiscalIdentifier is required for company"),
  )
  assert.doesNotThrow(() => { validateBuyer({ partyType: "individual", name: "Ion Popescu", fiscalIdentifier: "", address }) })
  assert.doesNotThrow(() => { validateBuyer({ partyType: "individual", name: "Ion Popescu", fiscalIdentifier: "1800101221144", address }) })
  assert.throws(
    () => { validateBuyer({ partyType: "individual", name: "Ion Popescu", fiscalIdentifier: "1800101221145", address }) },
    (error: unknown) => error instanceof ValidationFailure && error.issues.includes("fiscalIdentifier must be a valid Romanian CNP"),
  )
  assert.throws(
    () => { validateBuyer({ partyType: "person" as never, name: "Ion Popescu", fiscalIdentifier: "", address }) },
    (error: unknown) => error instanceof ValidationFailure && error.issues.includes("partyType must be company or individual"),
  )
})

void test("resolves exactly one effective-dated issuer tax configuration", () => {
  const issuer = {
    organizationId: "org-1",
    name: "Exemplu SRL",
    fiscalIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    vatConfigurations: [
      { code: "RO_STANDARD", rate: "19.00", effectiveFrom: "2020-01-01", effectiveTo: "2025-07-31" },
      { code: "RO_STANDARD", rate: "21.00", effectiveFrom: "2025-08-01" },
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
