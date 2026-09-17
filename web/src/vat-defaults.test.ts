import assert from "node:assert/strict"
import test from "node:test"

import { ARTICLE_310_EXEMPTION_REASON, type Issuer, type VatCatalogue, type VatConfiguration } from "./models.ts"
import { defaultVatCode, fallbackVatRegistration, hasStaleDraftTax, issuerForIssueDate, issuerVatRegistrationOn, normalizeRomanianCui, staleDraftLineIds, vatRatesForIssuer, vatRegistrationHistory } from "./vat-defaults.ts"

const standard = { vatCategoryCode: "S", vatExemptionReason: null } as const
const notSubject = { vatCategoryCode: "O", vatExemptionReason: ARTICLE_310_EXEMPTION_REASON } as const
const configuration = (value: Pick<VatConfiguration, "code" | "rate" | "effectiveFrom"> & Partial<Pick<VatConfiguration, "effectiveTo">>): VatConfiguration => ({ ...standard, ...value })

const catalogue: VatCatalogue = { rates: [
  { ...standard, code: "RO_STANDARD", rate: "19.00", kind: "standard", label: "19%", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
  { ...standard, code: "RO_REDUCED", rate: "9.00", kind: "reduced", label: "9%", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
  { ...standard, code: "RO_STANDARD", rate: "21.00", kind: "standard", label: "21%", effectiveFrom: "2025-08-01" },
  { ...standard, code: "RO_REDUCED", rate: "11.00", kind: "reduced", label: "11%", effectiveFrom: "2025-08-01" },
  { ...notSubject, code: "RO_NON_VAT", rate: "0.00", kind: "non_vat", label: "Scutit TVA — art. 310", effectiveFrom: "2025-01-01" },
] }
const issuer = (vatConfigurations: Issuer["vatConfigurations"]): Issuer => ({
  organizationId: "org-1", name: "Emitent", fiscalIdentifier: "12345674", address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" },
  legalForm: "srl", tradeRegistryNumber: "J22/1/2020", iban: "", bankName: "", socialCapital: "200.00", branding: null,
  defaultCurrency: "RON", defaultPaymentTermDays: 15, vatConfigurations, currentVat: null,
})

void test("selects effective server catalogue rates without hardcoded UI defaults", () => {
  const registered = issuer([configuration({ code: "RO_STANDARD", rate: "19", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" }), configuration({ code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" })])
  assert.deepEqual(vatRatesForIssuer(catalogue, registered, "2025-07-31").map(({ rate }) => rate), ["19.00", "9.00"])
  assert.equal(defaultVatCode(catalogue, registered, "2026-01-01"), "RO_STANDARD")
})

void test("detects stale draft snapshots against legal pairs and issuer registration", () => {
  const registered = issuer([configuration({ code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" })])
  assert.equal(hasStaleDraftTax("2026-01-01", [{ vatRateCode: "RO_REDUCED", vatRate: "11" }], catalogue, registered), false)
  assert.equal(hasStaleDraftTax("2026-01-01", [{ vatRateCode: "RO_STANDARD", vatRate: "19" }], catalogue, registered), true)
  const nonVat = issuer([{ ...notSubject, code: "RO_NON_VAT", rate: "0", effectiveFrom: "2025-08-01" }])
  assert.equal(hasStaleDraftTax("2026-01-01", [{ vatRateCode: "RO_STANDARD", vatRate: "21" }], catalogue, nonVat), true)
})

void test("groups registration history while retaining line-rate labels", () => {
  const history = vatRegistrationHistory([
    configuration({ code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" }),
    configuration({ code: "RO_REDUCED", rate: "11", effectiveFrom: "2025-08-01" }),
  ], catalogue)
  assert.deepEqual(history, [{ effectiveFrom: "2025-08-01", registered: true, rates: "21%, 11%" }])
})

void test("selects a future registration explicitly when no registration is current", () => {
  assert.deepEqual(fallbackVatRegistration([{ ...notSubject, code: "RO_NON_VAT", rate: "0", effectiveFrom: "2027-01-01" }], "2026-09-01"), {
    registered: false, nonVatBasis: "article_310", effectiveFrom: "2027-01-01", timing: "scheduled",
  })
})

void test("normalizes an optional RO input prefix to canonical numeric CUI", () => {
  assert.equal(normalizeRomanianCui(" ro12345674 "), "12345674")
  assert.equal(normalizeRomanianCui("12345674"), "12345674")
})

void test("identifies saved draft lines whose snapshot rate is stale despite an unchanged code", () => {
  const registered = issuer([configuration({ code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" })])
  const lines = [
    { id: "line-stale", vatRateCode: "RO_STANDARD", vatRate: "19.00" },
    { id: "line-valid", vatRateCode: "RO_STANDARD", vatRate: "21.00" },
  ]
  assert.deepEqual(staleDraftLineIds("2026-01-01", lines, catalogue, registered), ["line-stale"])
})

void test("projects dated seller identity only from complete VAT treatment facts", () => {
  const scheduled = issuer([
    configuration({ code: "RO_STANDARD", rate: "21.00", effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" }),
    { ...notSubject, code: "RO_NON_VAT", rate: "0.00", effectiveFrom: "2026-01-01" },
  ])
  assert.equal(issuerForIssueDate(scheduled, "2025-12-31").vatRegistered, true)
  assert.equal(issuerForIssueDate(scheduled, "2026-01-01").vatRegistered, false)
  const incomplete = issuer([{ ...standard, code: "RO_NON_VAT", rate: "0.00", effectiveFrom: "2026-01-01" }])
  assert.equal(issuerVatRegistrationOn(incomplete, "2026-01-01"), undefined)
})
