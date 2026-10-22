import assert from "node:assert/strict"
import test from "node:test"

import * as cubeMoney from "../cubes/invoicing/contracts/money.ts"
import { negateDecimal } from "../cubes/invoicing/corrections/index.ts"
import { characterCount, normalizeSpace } from "../cubes/invoicing/efactura/decimals.ts"
import { ROMANIAN_COUNTIES, addressCountyName } from "../cubes/invoicing/index.ts"
import { CIUS_TEXT_LIMITS, ciusTextLength, validateVatTreatment } from "../cubes/invoicing/domain/validation.ts"
import { normalizeIssuerDetails, validateIssuerForIssuance } from "../cubes/invoicing/issuer/index.ts"
import { romanianVatRates } from "../cubes/invoicing/issuer/domain/vat-catalogue.ts"
import { CIUS_TEXT_LIMITS as FRONTEND_CIUS_TEXT_LIMITS } from "../frontend/src/lib/cius-text-limits.ts"
import { canonicalVatTreatment } from "../frontend/src/lib/draft-decoders.ts"
import * as pdfFormat from "../kernel/documents/pdf-format.ts"
import { issuerIssuanceWarning } from "../frontend/src/lib/invoice-authoring-workflow.ts"
import { socialCapitalValue } from "../frontend/src/lib/issuer-legal.ts"
import * as frontendMoney from "../frontend/src/lib/money.ts"
import { ROMANIAN_COUNTIES as FRONTEND_COUNTIES, addressCountyName as frontendAddressCountyName } from "../frontend/src/lib/romanian-counties.ts"
import { vatTreatmentLabel } from "../frontend/src/lib/vat-snapshots.ts"

// The frontend mirrors these rules instead of importing the cube. Nothing else
// notices when one side changes alone (T-1651), so this probe holds them equal.

void test("the frontend county list is the cube's, code and name, in the same order", () => {
  assert.deepEqual(FRONTEND_COUNTIES, ROMANIAN_COUNTIES)
})

void test("the browser leaves the county out of an address exactly when the PDF does", () => {
  const cities = [...ROMANIAN_COUNTIES.map((county) => county.name), "Bucuresti", "BISTRITA NASAUD", "Satu  Mare", "Cluj-Napoca", "RO-XX", ""]
  for (const code of ROMANIAN_COUNTIES.map((county) => county.code)) {
    for (const city of cities) {
      assert.equal(frontendAddressCountyName(city, code), addressCountyName(city, code), `${city} @ ${code}`)
    }
  }
  // The one difference, kept on purpose: an unknown code (never valid in a party)
  // is left off the PDF, while the document view shows it as stored (T-1400).
  for (const city of cities) {
    assert.equal(addressCountyName(city, "RO-XX"), undefined, city)
    assert.equal(frontendAddressCountyName(city, "RO-XX"), city === "RO-XX" ? undefined : "RO-XX", city)
  }
})

void test("the frontend text limits are the cube's CIUS-RO limits", () => {
  assert.deepEqual(FRONTEND_CIUS_TEXT_LIMITS, CIUS_TEXT_LIMITS)
})

void test("the cube counts a text the way the e-Factura export counts it", () => {
  const samples = ["", "a", " a ", "\ta\r\n b\t", "a ", " a ", "﻿a", "😀😀", "  ș  ț  ", "a   b"]
  for (const sample of samples) {
    assert.equal(ciusTextLength(sample), characterCount(normalizeSpace(sample)), JSON.stringify(sample))
  }
})

void test("the editor warns about the issuer exactly when issuance would refuse it", () => {
  const complete = { legalForm: "srl", tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", iban: "", bankName: "" }
  const cases = [
    complete,
    { ...complete, socialCapital: "" },
    { ...complete, legalForm: "pfa", socialCapital: "" },
    { ...complete, tradeRegistryNumber: "" },
  ]
  for (const issuer of cases) {
    let refused = false
    try { validateIssuerForIssuance(issuer) } catch { refused = true }
    assert.equal(issuerIssuanceWarning(issuer) !== undefined, refused, JSON.stringify(issuer))
  }
})

const decimals = ["0", "-0", "-0.00", "0.00", "-0.05", "12.30", "01.00", "-02.0000", "2.5000", "0.001", "12.3", "-12.34", "007.50", "2.5", "-0.0001", "1.2345", "-1.23456",
  "90071992547409.93", "-90071992547409.93", "9223372036854775807.0000", "", " 1", "1 ", "+1", "--1", "1e2", ".5", "5.",
  "1,5", "abc", "NaN", "1.2.3"]
const units = [0n, 1n, -1n, 5n, -5n, 1234n, -1234n, 9007199254740993n, -9007199254740993n, 10n ** 25n]

void test("the browser's money arithmetic is the cube's: parse, sign, format, half up and compare", () => {
  const labels = ["formatAmount", "formatRate", "money"]
  assert.deepEqual(Object.keys(frontendMoney).filter((name) => !labels.includes(name)).sort(), Object.keys(cubeMoney).sort())
  for (const scale of [0, 2, 4]) {
    for (const value of decimals) {
      assert.deepEqual(frontendMoney.parseDecimal(value, scale), cubeMoney.parseDecimal(value, scale), `${value} @ ${String(scale)}`)
      assert.deepEqual(frontendMoney.parseUnsignedDecimal(value, scale), cubeMoney.parseUnsignedDecimal(value, scale), value)
      assert.equal(frontendMoney.isCanonicalDecimal(value, scale), cubeMoney.isCanonicalDecimal(value, scale), value)
    }
    for (const value of units) {
      assert.equal(frontendMoney.formatDecimal(value, scale), cubeMoney.formatDecimal(value, scale), String(value))
      assert.equal(frontendMoney.formatDecimal(-value, scale), cubeMoney.formatDecimal(-value, scale), String(-value))
    }
  }
  for (const numerator of [...units, 4999n, 5000n, 5001n, -4999n, -5000n, -5001n]) {
    for (const denominator of [2n, 3n, 10_000n]) {
      assert.equal(frontendMoney.divideHalfUp(numerator, denominator), cubeMoney.divideHalfUp(numerator, denominator))
    }
  }
  assert.throws(() => frontendMoney.divideHalfUp(1n, 0n), RangeError)
  for (const left of decimals) {
    for (const right of ["0", "-0.00", "12.30", "-90071992547409.93", "abc"]) {
      assert.equal(frontendMoney.compareDecimal(left, right), cubeMoney.compareDecimal(left, right), `${left} ? ${right}`)
    }
  }
})

void test("the browser labels an amount and a VAT rate exactly as the PDF prints them", () => {
  const amounts = ["0", "0.00", "-0", "-0.00", "-0.0000", "7", "999", "999.99", "-999.99", "1000", "1000.00", "-1000.00",
    "6600.00", "-1250000.00", "4800.0000", "12345678.9", "90071992547409.93", "9007199254740993.0000", "-24851819463866056.53",
    "007.50", "", " 1", "abc", "1,5", "1.2.3"]
  for (const value of amounts) assert.equal(frontendMoney.formatAmount(value), pdfFormat.formatAmount(value), JSON.stringify(value))
  assert.deepEqual(["6600.00", "-1250000.00", "0.00", "-0.00", "4800.0000", "1000", "999.99", "9007199254740993.0000"].map(pdfFormat.formatAmount),
    ["6,600.00", "-1,250,000.00", "0.00", "0.00", "4,800.0000", "1,000", "999.99", "9,007,199,254,740,993.0000"])
  for (const rate of ["21.00", "21", "20.50", "9.5", "0.00", "0", "100.00", "10.0", "11"]) {
    assert.equal(frontendMoney.formatRate(rate), pdfFormat.formatRate(rate), rate)
  }
  assert.deepEqual(["21.00", "20.50", "0.00", "100.00", "10.0"].map(pdfFormat.formatRate), ["21", "20.5", "0", "100", "10"])
  assert.equal(frontendMoney.money("6600.00", "RON"), `${pdfFormat.formatAmount("6600.00")} RON`)
})

void test("a storno amount negates to the opposite sign at the same scale, read alike on both sides", () => {
  for (const value of ["151.25", "-151.25", "0.00", "-0.00", "1.2500", "-2.5000", "-0.0000", "90071992547409.93"]) {
    const negated = negateDecimal(value)
    assert.equal(negated.split(".")[1]?.length, value.split(".")[1]?.length, value)
    assert.equal(negateDecimal(negated), value.replace(/^-(?=[0.]+$)/u, ""), value)
    for (const money of [cubeMoney, frontendMoney]) {
      // Opposite signs add up to zero, and zero stays zero.
      assert.equal(money.compareDecimal(negated, "0") + money.compareDecimal(value, "0"), 0, value)
    }
  }
})

void test("the browser admits a VAT rate exactly when the cube does", () => {
  const article310 = "Regim special de scutire conform art. 310 din Codul fiscal"
  const accepts = (run) => { try { run(); return true } catch { return false } }
  for (const rate of ["0", "0.0", "0.00", "0.01", "1", "9.5", "21", "21.00", "99.99", "100", "100.00", "100.01", "101",
    "021", "21.000", " 21", "+21", "-21", "-0", "1e1", ".5", "21.", "", "abc"]) {
    for (const [code, category, reason] of [["RO_STANDARD", "S", null], ["RO_NON_VAT", "O", article310]]) {
      assert.equal(accepts(() => { canonicalVatTreatment(code, rate, category, reason) }),
        accepts(() => { validateVatTreatment(code, rate, category, reason) }), `${code} ${JSON.stringify(rate)}`)
    }
  }
})

void test("an article 310 treatment is labelled as the catalogue names it", () => {
  const exemption = romanianVatRates.find(({ code }) => code === "RO_NON_VAT")
  assert.equal(vatTreatmentLabel({ vatCategoryCode: "O", rate: exemption.rate }), exemption.label)
})

void test("the browser normalizes a social capital to what the cube stores", () => {
  const issuer = { legalForm: "srl", tradeRegistryNumber: "", iban: "", bankName: "" }
  for (const raw of ["", " 5 ", "0", "00", "0.5", "007.10", "9".repeat(16), `0${"9".repeat(15)}.99`, "9".repeat(17), "1.001",
    "-1", "+1", "1e3", ".5", "1.", "1,00"]) {
    let cube
    try { cube = { kind: "ready", value: normalizeIssuerDetails({ ...issuer, socialCapital: raw }).socialCapital } } catch { cube = { kind: "issue" } }
    const browser = socialCapitalValue(raw)
    assert.deepEqual(browser.kind === "ready" ? browser : { kind: "issue" }, cube, JSON.stringify(raw))
  }
})
