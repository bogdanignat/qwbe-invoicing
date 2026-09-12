import assert from "node:assert/strict"
import test from "node:test"

import type { Issuer, VatCatalogue } from "./models.ts"
import { defaultVatCode, fallbackVatRegistration, hasStaleDraftTax, shouldApplyVatInference, staleDraftLineIds, vatRatesForIssuer, vatRegistrationHistory } from "./vat-defaults.ts"

const catalogue: VatCatalogue = { inferredRegistration: null, rates: [
  { code: "RO_STANDARD", rate: "19.00", kind: "standard", label: "19%", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
  { code: "RO_REDUCED", rate: "9.00", kind: "reduced", label: "9%", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
  { code: "RO_STANDARD", rate: "21.00", kind: "standard", label: "21%", effectiveFrom: "2025-08-01" },
  { code: "RO_REDUCED", rate: "11.00", kind: "reduced", label: "11%", effectiveFrom: "2025-08-01" },
  { code: "RO_NON_VAT", rate: "0.00", kind: "non_vat", label: "0%", effectiveFrom: "2025-01-01" },
] }
const issuer = (vatConfigurations: Issuer["vatConfigurations"]): Issuer => ({
  organizationId: "org-1", name: "Emitent", fiscalIdentifier: "RO12345674", address: { countryCode: "RO", city: "Iași", street: "Strada 1" },
  legalForm: "srl", tradeRegistryNumber: "J22/1/2020", iban: "", bankName: "", socialCapital: "200.00", branding: null,
  defaultCurrency: "RON", defaultPaymentTermDays: 15, vatConfigurations, currentVat: null,
})

void test("selects effective server catalogue rates without hardcoded UI defaults", () => {
  const registered = issuer([{ code: "RO_STANDARD", rate: "19", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" }, { code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" }])
  assert.deepEqual(vatRatesForIssuer(catalogue, registered, "2025-07-31").map(({ rate }) => rate), ["19.00", "9.00"])
  assert.equal(defaultVatCode(catalogue, registered, "2026-01-01"), "RO_STANDARD")
})

void test("detects stale draft snapshots against legal pairs and issuer registration", () => {
  const registered = issuer([{ code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" }])
  assert.equal(hasStaleDraftTax("2026-01-01", [{ vatRateCode: "RO_REDUCED", vatRate: "11" }], catalogue, registered), false)
  assert.equal(hasStaleDraftTax("2026-01-01", [{ vatRateCode: "RO_STANDARD", vatRate: "19" }], catalogue, registered), true)
  const nonVat = issuer([{ code: "RO_NON_VAT", rate: "0", effectiveFrom: "2025-08-01" }])
  assert.equal(hasStaleDraftTax("2026-01-01", [{ vatRateCode: "RO_STANDARD", vatRate: "21" }], catalogue, nonVat), true)
})

void test("groups registration history while retaining line-rate labels", () => {
  const history = vatRegistrationHistory([
    { code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" },
    { code: "RO_REDUCED", rate: "11", effectiveFrom: "2025-08-01" },
  ], catalogue)
  assert.deepEqual(history, [{ effectiveFrom: "2025-08-01", registered: true, rates: "21%, 11%" }])
})

void test("selects a future registration explicitly when no registration is current", () => {
  assert.deepEqual(fallbackVatRegistration([{ code: "RO_NON_VAT", rate: "0", effectiveFrom: "2027-01-01" }], "2026-09-01"), {
    registered: false, effectiveFrom: "2027-01-01", timing: "scheduled",
  })
})

void test("rejects a deferred VAT inference after the CUI or form epoch changes", () => {
  assert.equal(shouldApplyVatInference({
    requestedFiscalIdentifier: "RO12345674", currentFiscalIdentifier: "12345674",
    requestIsCurrent: true, manuallySelectedVat: false,
  }), false)
  assert.equal(shouldApplyVatInference({
    requestedFiscalIdentifier: "RO12345674", currentFiscalIdentifier: "RO12345674",
    requestIsCurrent: false, manuallySelectedVat: false,
  }), false)
  assert.equal(shouldApplyVatInference({
    requestedFiscalIdentifier: "RO12345674", currentFiscalIdentifier: "RO12345674",
    requestIsCurrent: true, manuallySelectedVat: true,
  }), false)
  assert.equal(shouldApplyVatInference({
    requestedFiscalIdentifier: " ro12345674 ", currentFiscalIdentifier: "RO12345674",
    requestIsCurrent: true, manuallySelectedVat: false,
  }), true)
})

void test("identifies saved draft lines whose snapshot rate is stale despite an unchanged code", () => {
  const registered = issuer([{ code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" }])
  const lines = [
    { id: "line-stale", vatRateCode: "RO_STANDARD", vatRate: "19.00" },
    { id: "line-valid", vatRateCode: "RO_STANDARD", vatRate: "21.00" },
  ]
  assert.deepEqual(staleDraftLineIds("2026-01-01", lines, catalogue, registered), ["line-stale"])
})
