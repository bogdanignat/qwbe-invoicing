import assert from "node:assert/strict"
import test from "node:test"

import { issuerIssuanceWarning, normalizeBankName, normalizeIban, normalizeIssuerLegalDetails, normalizeSocialCapital, normalizeTradeRegistryNumber } from "./issuer-details.ts"

void test("normalizes Romanian issuer legal details using standalone parity vectors", () => {
  assert.equal(normalizeTradeRegistryNumber("  j40/1234/2020 "), "J40/1234/2020")
  assert.equal(normalizeTradeRegistryNumber(" f1234567890123 "), "F1234567890123")
  assert.equal(normalizeTradeRegistryNumber(""), "")
  assert.equal(normalizeSocialCapital(" 000200 "), "200.00")
  assert.equal(normalizeSocialCapital("000.5"), "0.50")
  assert.equal(normalizeSocialCapital("0.05"), "0.05")
  assert.equal(normalizeSocialCapital(""), "")
  assert.equal(normalizeIban(" ro49 aaaa 1b31 0075 9384 0000 "), "RO49AAAA1B31007593840000")
  assert.equal(normalizeIban("gb82 west 1234 5698 7654 32"), "GB82WEST12345698765432")
  assert.equal(normalizeBankName("  Banca Transilvania  "), "Banca Transilvania")
  assert.deepEqual(normalizeIssuerLegalDetails({
    legalForm: "srl", tradeRegistryNumber: " j40/1234/2020 ", socialCapital: "00200", iban: "ro49 aaaa1b31007593840000", bankName: " BT ",
  }), {
    legalForm: "srl", tradeRegistryNumber: "J40/1234/2020", socialCapital: "200.00", iban: "RO49AAAA1B31007593840000", bankName: "BT",
  })
})

void test("rejects malformed issuer legal details", () => {
  for (const value of ["J40/1234/20", "J123456789012", "C40/1234/2020", "J40/1/2020\nX"]) assert.throws(() => normalizeTradeRegistryNumber(value))
  for (const value of ["-1", "1,20", "1.234", "1234567890123456789.00", "RON 200"]) assert.throws(() => normalizeSocialCapital(value))
  for (const value of ["RO49AAAA1B31007593840001", "RO49AAAA", "RO49AAAA1B310075938400000", "GB82 WEST 1234 5698 7654 3!"]) assert.throws(() => normalizeIban(value))
  assert.throws(() => normalizeBankName(`Banca\nNouă`))
  assert.throws(() => normalizeBankName("x".repeat(121)))
  assert.throws(() => normalizeIssuerLegalDetails({ legalForm: "", tradeRegistryNumber: "", socialCapital: "", iban: "", bankName: "" }))
})

void test("warns before issuance without making optional PFA capital mandatory", () => {
  const base = { tradeRegistryNumber: "J40/1234/2020", socialCapital: "200.00" }
  assert.equal(issuerIssuanceWarning({ ...base, legalForm: "srl" }), undefined)
  assert.match(issuerIssuanceWarning({ ...base, legalForm: "srl", socialCapital: "" }) ?? "", /capitalul social/i)
  assert.equal(issuerIssuanceWarning({ ...base, legalForm: "pfa", socialCapital: "" }), undefined)
  assert.match(issuerIssuanceWarning({ ...base, legalForm: "pfa", tradeRegistryNumber: "" }) ?? "", /registrul comerțului/i)
})
