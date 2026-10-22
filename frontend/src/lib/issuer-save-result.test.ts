import assert from "node:assert/strict"
import test from "node:test"

import { parseApiFailure } from "./api-errors.ts"
import { decodeIssuerSaveResult, issuerSaveWarning } from "./issuer-save-result.ts"

const SAVED = {
  organizationId: "org-1", name: "Firma Test SRL", fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "Cluj-Napoca", street: "Str. Mică 1", county: "RO-CJ" },
  legalForm: "srl", tradeRegistryNumber: "J12/1234/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca Test",
  socialCapital: "200.00", defaultCurrency: "RON", defaultPaymentTermDays: 15,
  vatConfigurations: [], currentVat: null, branding: null,
}

void test("the save answer keeps its warnings next to the profile", () => {
  const checked = decodeIssuerSaveResult({ ...SAVED, warnings: [] })
  assert.equal(checked.issuer.fiscalIdentifier, "12345674")
  assert.deepEqual(checked.warnings, [])
  assert.equal("warnings" in checked.issuer, false, "the cached profile is the read model, without the save's warnings")
  assert.deepEqual(decodeIssuerSaveResult({ ...SAVED, warnings: ["vat_registry_not_checked"] }).warnings, ["vat_registry_not_checked"])
})

void test("a save answer without warnings, or with one the screen cannot name, is a contract error", () => {
  assert.throws(() => decodeIssuerSaveResult(SAVED), /invalid warnings/u)
  assert.throws(() => decodeIssuerSaveResult({ ...SAVED, warnings: null }), /invalid warnings/u)
  assert.throws(() => decodeIssuerSaveResult({ ...SAVED, warnings: ["something_new"] }), /invalid warning/u)
})

void test("only an unchecked fiscal change has something to say", () => {
  assert.equal(issuerSaveWarning([]), undefined)
  assert.match(issuerSaveWarning(["vat_registry_not_checked"]) ?? "", /fără verificare în registrul ANAF/u)
})

void test("the refusals of a fiscal change read as Romanian sentences, never as codes", () => {
  const documents = parseApiFailure({ error: "DomainConflict", code: "vat_change_affects_issued_documents" }, 409)
  assert.match(documents.message, /există facturi sau stornouri emise/u)
  assert.equal(documents.code, "vat_change_affects_issued_documents")
  assert.match(parseApiFailure({ error: "DomainConflict", code: "fiscal_identifier_change_has_issued_documents" }, 409).message,
    /CIF-ul firmei nu mai poate fi schimbat/u)
  assert.match(parseApiFailure({ error: "DomainConflict", code: "issuer_changed_concurrently" }, 409).message, /Reîncarcă pagina/u)
  const unavailable = parseApiFailure({ error: "vat_registry_unavailable" }, 503)
  assert.match(unavailable.message, /nu răspunde acum.*Încearcă mai târziu/u)
  assert.equal(unavailable.status, 503)
  const mismatch = "ANAF arată că CIF-ul 12345674 nu este înregistrat în scopuri de TVA la 2026-09-01."
  assert.equal(parseApiFailure({ error: "ValidationFailure", issues: [mismatch] }, 400).message, mismatch)
})
