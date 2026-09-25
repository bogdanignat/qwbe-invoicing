import assert from "node:assert/strict"
import test from "node:test"

import { bankNameValue, ibanValue, socialCapitalValue, tradeRegistryValue } from "./issuer-legal.ts"

void test("trade registry number — accepts both accepted forms, upper-cased and trimmed", () => {
  assert.deepEqual(tradeRegistryValue("  j12/1234/2020 "), { kind: "ready", value: "J12/1234/2020" })
  assert.deepEqual(tradeRegistryValue("F1234567890123"), { kind: "ready", value: "F1234567890123" })
  assert.deepEqual(tradeRegistryValue("   "), { kind: "ready", value: "" })
})

void test("trade registry number — refuses a shape the backend would reject", () => {
  assert.deepEqual(tradeRegistryValue("12/1234/2020"), {
    kind: "issue", message: "Numărul de la Registrul Comerțului nu are formatul acceptat.",
  })
  assert.equal(tradeRegistryValue("J12/1234/2020 SRL Cluj").kind, "issue")
  assert.deepEqual(tradeRegistryValue("J".repeat(33)), {
    kind: "issue",
    message: "Numărul de la Registrul Comerțului trebuie să fie ASCII, pe o singură linie, maximum 32 de caractere.",
  })
  assert.equal(tradeRegistryValue("J12/1234/2020\n").kind, "ready")
  assert.equal(tradeRegistryValue("J12/1234/20ă0").kind, "issue")
})

void test("social capital — stores one capital for 200 and 200.00", () => {
  assert.deepEqual(socialCapitalValue("200"), { kind: "ready", value: "200.00" })
  assert.deepEqual(socialCapitalValue(" 200.5 "), { kind: "ready", value: "200.50" })
  assert.deepEqual(socialCapitalValue("0200.00"), { kind: "ready", value: "200.00" })
  assert.deepEqual(socialCapitalValue("0"), { kind: "ready", value: "0.00" })
  assert.deepEqual(socialCapitalValue(""), { kind: "ready", value: "" })
})

void test("social capital — refuses a sum that is not a non-negative RON amount", () => {
  const message = "Capitalul social trebuie să fie o sumă RON nenegativă, cu maximum 18 cifre întregi și 2 zecimale."
  assert.deepEqual(socialCapitalValue("-5"), { kind: "issue", message })
  assert.deepEqual(socialCapitalValue("200.005"), { kind: "issue", message })
  assert.deepEqual(socialCapitalValue("200,00"), { kind: "issue", message })
  assert.deepEqual(socialCapitalValue("1".repeat(19)), { kind: "issue", message })
})

void test("IBAN — checks the mod-97 digit over the whitespace-free value", () => {
  assert.deepEqual(ibanValue("RO49 AAAA 1B31 0075 9384 0000"), {
    kind: "ready", value: "RO49AAAA1B31007593840000",
  })
  assert.deepEqual(ibanValue(""), { kind: "ready", value: "" })
  assert.deepEqual(ibanValue("RO50AAAA1B31007593840000"), {
    kind: "issue", message: "Cifra de control a IBAN-ului este invalidă.",
  })
})

void test("IBAN — refuses a structure no country uses and a Romanian one of the wrong length", () => {
  assert.deepEqual(ibanValue("RO49AAAA1B3100759384"), {
    kind: "issue", message: "Un IBAN românesc trebuie să aibă exact 24 de caractere.",
  })
  const message = "IBAN-ul nu are structura internațională validă."
  assert.deepEqual(ibanValue("4949AAAA1B31007593840000"), { kind: "issue", message })
  assert.deepEqual(ibanValue("RO49"), { kind: "issue", message })
  assert.deepEqual(ibanValue("RO49AAAA1B310075938400-0"), { kind: "issue", message })
})

void test("bank name — keeps a trimmed name and refuses a second line or 121 characters", () => {
  assert.deepEqual(bankNameValue("  Banca Transilvania  "), { kind: "ready", value: "Banca Transilvania" })
  assert.deepEqual(bankNameValue("ă".repeat(120)), { kind: "ready", value: "ă".repeat(120) })
  const message = "Numele băncii trebuie să aibă maximum 120 de caractere și o singură linie."
  assert.deepEqual(bankNameValue("ă".repeat(121)), { kind: "issue", message })
  assert.deepEqual(bankNameValue("Banca\nTest"), { kind: "issue", message })
})
