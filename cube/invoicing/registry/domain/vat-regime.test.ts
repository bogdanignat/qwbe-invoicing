import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../../contracts/failures.ts"
import type { IssuerProfile } from "../../domain/invoice.ts"
import { article310VatExemptionReason } from "../../domain/validation.ts"
import { romanianVatRates, vatRatesOn } from "./vat-catalogue.ts"
import { currentVatRegistration, scheduleVatRegistration, validateVatForIssuance } from "./vat-regime.ts"

const issuer = (vatConfigurations: IssuerProfile["vatConfigurations"]): IssuerProfile => ({
  organizationId: "org-1", name: "Exemplu", fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" },
  legalForm: "srl", tradeRegistryNumber: "J22/1/2020", iban: "", bankName: "", socialCapital: "200.00",
  defaultCurrency: "RON", defaultPaymentTermDays: 15, vatConfigurations, branding: null,
})
const taxable = { vatCategoryCode: "S" as const, vatExemptionReason: null }
const notSubject = { vatCategoryCode: "O" as const, vatExemptionReason: article310VatExemptionReason }
const taxableLine = (vatRateCode: string, vatRate: string) => ({ vatRateCode, vatRate, ...taxable })

void test("serves distinct historical and current legal VAT pairs", () => {
  assert.deepEqual(vatRatesOn("2025-07-31").map(({ code, rate }) => `${code}/${rate}`), ["RO_STANDARD/19.00", "RO_REDUCED/9.00", "RO_REDUCED_5/5.00", "RO_NON_VAT/0.00"])
  assert.deepEqual(vatRatesOn("2025-08-01").map(({ code, rate }) => `${code}/${rate}`), ["RO_STANDARD/21.00", "RO_REDUCED/11.00", "RO_NON_VAT/0.00"])
  assert.equal(romanianVatRates.some(({ rate }) => rate === "19.00"), true)
  assert.equal(romanianVatRates.filter(({ kind }) => kind !== "non_vat")
    .every(({ rate, vatCategoryCode, vatExemptionReason }) => Number(rate) > 0 && vatCategoryCode === "S" && vatExemptionReason === null), true)
  assert.deepEqual(romanianVatRates.find(({ code }) => code === "RO_NON_VAT"), {
    code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "O", vatExemptionReason: article310VatExemptionReason,
    kind: "non_vat", label: "Scutit TVA — art. 310", effectiveFrom: "2025-01-01",
  })
})

void test("server materializes every later catalogue epoch for a registered schedule", () => {
  const scheduled = scheduleVatRegistration([], { registered: true, effectiveFrom: "2025-01-01" })
  assert.deepEqual(scheduled, [
    { code: "RO_STANDARD", rate: "19.00", ...taxable, effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
    { code: "RO_REDUCED", rate: "9.00", ...taxable, effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
    { code: "RO_REDUCED_5", rate: "5.00", ...taxable, effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
    { code: "RO_STANDARD", rate: "21.00", ...taxable, effectiveFrom: "2025-08-01" },
    { code: "RO_REDUCED", rate: "11.00", ...taxable, effectiveFrom: "2025-08-01" },
  ])
  assert.deepEqual(currentVatRegistration(scheduled, "2026-01-01"), { registered: true, effectiveFrom: "2025-08-01" })
  assert.doesNotThrow(() => { validateVatForIssuance(issuer(scheduled), "2025-07-31", [taxableLine("RO_STANDARD", "19")]) })
  assert.doesNotThrow(() => { validateVatForIssuance(issuer(scheduled), "2025-08-01", [taxableLine("RO_STANDARD", "21")]) })
})

void test("same-state saves are no-ops and preserve later registration transitions", () => {
  const registered = scheduleVatRegistration([], { registered: true, effectiveFrom: "2025-08-01" })
  const withFuture = scheduleVatRegistration(registered, { registered: false, effectiveFrom: "2027-01-01", nonVatBasis: "article_310" })
  assert.equal(scheduleVatRegistration(withFuture, { registered: true, effectiveFrom: "2026-09-01" }), withFuture)
  assert.deepEqual(currentVatRegistration(withFuture, "2027-01-01"), { registered: false, nonVatBasis: "article_310", effectiveFrom: "2027-01-01" })
  assert.deepEqual(scheduleVatRegistration(withFuture, { registered: false, effectiveFrom: "2026-09-01", nonVatBasis: "article_310" }), [
    { code: "RO_STANDARD", rate: "21.00", ...taxable, effectiveFrom: "2025-08-01", effectiveTo: "2026-08-31" },
    { code: "RO_REDUCED", rate: "11.00", ...taxable, effectiveFrom: "2025-08-01", effectiveTo: "2026-08-31" },
    { code: "RO_NON_VAT", rate: "0.00", ...notSubject, effectiveFrom: "2026-09-01" },
  ])
})

void test("current registration is absent before a future activation and after expiry", () => {
  assert.equal(currentVatRegistration([{ code: "RO_NON_VAT", rate: "0", ...notSubject, effectiveFrom: "2027-01-01" }], "2026-01-01"), undefined)
  assert.equal(currentVatRegistration([{ code: "RO_NON_VAT", rate: "0", ...notSubject, effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" }], "2026-01-01"), undefined)
})

void test("issuance guard permits mixed standard/reduced lines and rejects stale or registration-invalid pairs", () => {
  const registered = issuer(scheduleVatRegistration([], { registered: true, effectiveFrom: "2025-08-01" }))
  assert.doesNotThrow(() => { validateVatForIssuance(registered, "2026-01-01", [
    taxableLine("RO_STANDARD", "21"), taxableLine("RO_REDUCED", "11.00"),
  ]) })
  assert.throws(() => { validateVatForIssuance(registered, "2026-01-01", [taxableLine("RO_STANDARD", "19.00")]) }, ValidationFailure)
  const nonVat = issuer(scheduleVatRegistration([], { registered: false, effectiveFrom: "2025-08-01", nonVatBasis: "article_310" }))
  assert.throws(() => { validateVatForIssuance(nonVat, "2026-01-01", [taxableLine("RO_STANDARD", "21.00")]) }, (error) =>
    error instanceof ValidationFailure && error.issues.includes("VAT pair RO_STANDARD/21.00 requires a VAT-registered issuer on 2026-01-01"))
})

void test("requires explicit article 310 before same-state early return and rejects corrupted tuples", () => {
  const nonVat = scheduleVatRegistration([], { registered: false, effectiveFrom: "2025-08-01", nonVatBasis: "article_310" })
  assert.throws(() => { scheduleVatRegistration(nonVat, { registered: false, effectiveFrom: "2026-01-01" } as never) }, ValidationFailure)
  assert.throws(() => { scheduleVatRegistration([], { registered: true, effectiveFrom: "2025-08-01", nonVatBasis: "article_310" } as never) }, ValidationFailure)
  assert.throws(() => { currentVatRegistration([{ ...nonVat[0] as NonNullable<typeof nonVat[0]>, vatExemptionReason: null }], "2026-01-01") }, ValidationFailure)
})
