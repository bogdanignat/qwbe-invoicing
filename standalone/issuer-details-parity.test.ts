import assert from "node:assert/strict"
import test from "node:test"
import { normalizeIssuerDetails, validateIssuerForIssuance } from "../cube/invoicing/registry/index.ts"
import { issuerIssuanceWarning, normalizeIssuerLegalDetails } from "../web/src/issuer-details.ts"

const base = { legalForm: "srl" as const, tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", iban: "", bankName: "" }

void test("issuer UI and backend normalizers accept and reject the same boundary vectors", () => {
  const valid = [base, { ...base, legalForm: "pfa" as const, tradeRegistryNumber: " f40/123/2020 ", socialCapital: "" },
    // Synthetic ONRC shape only, not an identifier verified against the registry.
    { ...base, tradeRegistryNumber: "J2024000001401", socialCapital: "0" },
    { ...base, tradeRegistryNumber: "", socialCapital: "", iban: " gb82 west 1234 5698 7654 32 ", bankName: " Bancă Știință " },
    { ...base, socialCapital: "999999999999999999.99", iban: "RO49AAAA1B31007593840000", bankName: "😀".repeat(120) },
    { ...base, socialCapital: "009007199254740993.1" }]
  for (const input of valid) {
    const canonical = normalizeIssuerDetails(input)
    assert.deepEqual(normalizeIssuerLegalDetails(input), canonical)
    assert.deepEqual(normalizeIssuerDetails(canonical), canonical)
  }
  const invalid = [
    { legalForm: "sa" }, { legalForm: "" }, { legalForm: undefined },
    { tradeRegistryNumber: "J40/1" }, { tradeRegistryNumber: "J40/1/2020\u0000" }, { tradeRegistryNumber: `J40/${"1".repeat(30)}/2020` },
    { socialCapital: "1.001" }, { socialCapital: "-1" }, { socialCapital: "1,00" }, { socialCapital: "1e3" }, { socialCapital: "9".repeat(19) },
    { iban: "RO48AAAA1B31007593840000" }, { iban: "RO49AAAA1B310075938400000" }, { iban: "RO49AAAA1B3100759384000\u200b0" },
    ...["\u0000", "\u200b", "\ud800", "\ue000", "\u0378", "\u2028", "\u2029"].map((character) => ({ bankName: `A${character}B` })),
    { bankName: "😀".repeat(121) },
  ]
  for (const patch of invalid) {
    const input = { ...base, ...patch }
    assert.throws(() => normalizeIssuerDetails(input as never), Error, JSON.stringify(patch))
    assert.throws(() => normalizeIssuerLegalDetails(input as never), Error, JSON.stringify(patch))
  }
})

void test("UI readiness matches backend requiredness for both supported issuer forms", () => {
  for (const legalForm of ["srl", "pfa"] as const) {
    for (const tradeRegistryNumber of ["", "F40/123/2020"]) {
      for (const socialCapital of ["", "200.00"]) {
        const issuer = { ...base, legalForm, tradeRegistryNumber, socialCapital }
        if (issuerIssuanceWarning(issuer) === undefined) assert.doesNotThrow(() => { validateIssuerForIssuance(issuer) })
        else assert.throws(() => { validateIssuerForIssuance(issuer) })
      }
    }
  }
})
