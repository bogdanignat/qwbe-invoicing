import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../../contracts/failures.ts"
import type { IssuerProfile } from "../../domain/invoice.ts"
import { currentVatRegistration, inferVatRegistration, romanianVatRates, scheduleVatRegistration, validateVatForIssuance, vatRatesOn } from "./vat-regime.ts"

const issuer = (vatConfigurations: IssuerProfile["vatConfigurations"]): IssuerProfile => ({
  organizationId: "org-1", name: "Exemplu", fiscalIdentifier: "RO12345674",
  address: { countryCode: "RO", city: "Iași", street: "Strada 1" },
  legalForm: "srl", tradeRegistryNumber: "J22/1/2020", iban: "", bankName: "", socialCapital: "200.00",
  defaultCurrency: "RON", defaultPaymentTermDays: 15, vatConfigurations, branding: null,
})

void test("serves distinct historical and current legal VAT pairs", () => {
  assert.deepEqual(vatRatesOn("2025-07-31").map(({ code, rate }) => `${code}/${rate}`), ["RO_STANDARD/19.00", "RO_REDUCED/9.00", "RO_REDUCED_5/5.00", "RO_NON_VAT/0.00"])
  assert.deepEqual(vatRatesOn("2025-08-01").map(({ code, rate }) => `${code}/${rate}`), ["RO_STANDARD/21.00", "RO_REDUCED/11.00", "RO_NON_VAT/0.00"])
  assert.equal(romanianVatRates.some(({ rate }) => rate === "19.00"), true)
})

void test("treats CUI inference as a suggestion only", () => {
  assert.equal(inferVatRegistration("RO", " RO45561046 "), true)
  assert.equal(inferVatRegistration("ro", "45561046"), false)
  assert.equal(inferVatRegistration("DE", "RO45561046"), undefined)
})

void test("server materializes every later catalogue epoch for a registered schedule", () => {
  const scheduled = scheduleVatRegistration([], { registered: true, effectiveFrom: "2025-01-01" })
  assert.deepEqual(scheduled, [
    { code: "RO_STANDARD", rate: "19.00", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
    { code: "RO_REDUCED", rate: "9.00", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
    { code: "RO_REDUCED_5", rate: "5.00", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
    { code: "RO_STANDARD", rate: "21.00", effectiveFrom: "2025-08-01" },
    { code: "RO_REDUCED", rate: "11.00", effectiveFrom: "2025-08-01" },
  ])
  assert.deepEqual(currentVatRegistration(scheduled, "2026-01-01"), { registered: true, effectiveFrom: "2025-08-01" })
  assert.doesNotThrow(() => { validateVatForIssuance(issuer(scheduled), "2025-07-31", [{ vatRateCode: "RO_STANDARD", vatRate: "19" }]) })
  assert.doesNotThrow(() => { validateVatForIssuance(issuer(scheduled), "2025-08-01", [{ vatRateCode: "RO_STANDARD", vatRate: "21" }]) })
})

void test("same-state saves are no-ops and preserve later registration transitions", () => {
  const registered = scheduleVatRegistration([], { registered: true, effectiveFrom: "2025-08-01" })
  const withFuture = scheduleVatRegistration(registered, { registered: false, effectiveFrom: "2027-01-01" })
  assert.equal(scheduleVatRegistration(withFuture, { registered: true, effectiveFrom: "2026-09-01" }), withFuture)
  assert.deepEqual(currentVatRegistration(withFuture, "2027-01-01"), { registered: false, effectiveFrom: "2027-01-01" })
  assert.deepEqual(scheduleVatRegistration(withFuture, { registered: false, effectiveFrom: "2026-09-01" }), [
    { code: "RO_STANDARD", rate: "21.00", effectiveFrom: "2025-08-01", effectiveTo: "2026-08-31" },
    { code: "RO_REDUCED", rate: "11.00", effectiveFrom: "2025-08-01", effectiveTo: "2026-08-31" },
    { code: "RO_NON_VAT", rate: "0.00", effectiveFrom: "2026-09-01" },
  ])
})

void test("current registration is absent before a future activation and after expiry", () => {
  assert.equal(currentVatRegistration([{ code: "RO_NON_VAT", rate: "0", effectiveFrom: "2027-01-01" }], "2026-01-01"), undefined)
  assert.equal(currentVatRegistration([{ code: "RO_NON_VAT", rate: "0", effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" }], "2026-01-01"), undefined)
})

void test("issuance guard permits mixed standard/reduced lines and rejects stale or registration-invalid pairs", () => {
  const registered = issuer(scheduleVatRegistration([], { registered: true, effectiveFrom: "2025-08-01" }))
  assert.doesNotThrow(() => { validateVatForIssuance(registered, "2026-01-01", [
    { vatRateCode: "RO_STANDARD", vatRate: "21" }, { vatRateCode: "RO_REDUCED", vatRate: "11.00" },
  ]) })
  assert.throws(() => { validateVatForIssuance(registered, "2026-01-01", [{ vatRateCode: "RO_STANDARD", vatRate: "19.00" }]) }, ValidationFailure)
  const nonVat = issuer(scheduleVatRegistration([], { registered: false, effectiveFrom: "2025-08-01" }))
  assert.throws(() => { validateVatForIssuance(nonVat, "2026-01-01", [{ vatRateCode: "RO_STANDARD", vatRate: "21.00" }]) }, (error) =>
    error instanceof ValidationFailure && error.issues.includes("VAT pair RO_STANDARD/21.00 requires a VAT-registered issuer on 2026-01-01"))
})
