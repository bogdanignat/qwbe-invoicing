import assert from "node:assert/strict"
import test from "node:test"

import { decodeIssuer } from "./authoring-reference-decoders.ts"
import { decodeIssuerBranding } from "./branding-decoder.ts"

const ISSUER = {
  organizationId: "org-1",
  name: "Firma Test SRL",
  fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "Cluj-Napoca", street: "Str. Mică 1", county: "RO-CJ" },
  legalForm: "srl",
  tradeRegistryNumber: "J12/1234/2020",
  iban: "RO49AAAA1B31007593840000",
  bankName: "Banca Test",
  socialCapital: "200.00",
  defaultCurrency: "RON",
  defaultPaymentTermDays: 15,
  vatConfigurations: [],
  currentVat: null,
  branding: null,
}

void test("branding decoding — keeps the re-encoded PNG the backend answered with", () => {
  assert.deepEqual(decodeIssuerBranding({ text: "Marca", image: { pngBase64: "AAA", width: 120, height: 40 } }), {
    text: "Marca", image: { pngBase64: "AAA", width: 120, height: 40 },
  })
  assert.equal(decodeIssuerBranding(null), null)
  assert.deepEqual(decodeIssuerBranding({ text: null, image: null }), { text: null, image: null })
})

void test("branding decoding — refuses an image that is not the shape the settings screen renders", () => {
  assert.throws(() => decodeIssuerBranding({ text: null, image: { pngBase64: "AAA", width: "120", height: 40 } }))
  assert.throws(() => decodeIssuerBranding({ text: 7, image: null }))
})

void test("issuer decoding — carries the branding the settings screen edits", () => {
  const issuer = decodeIssuer({ ...ISSUER, branding: { text: "Marca", image: null } })
  assert.deepEqual(issuer.branding, { text: "Marca", image: null })
})

void test("issuer decoding — an issuer with no brand answers `null`, and an absent field is refused", () => {
  assert.equal(decodeIssuer(ISSUER).branding, null)
  assert.equal(decodeIssuer({ ...ISSUER, branding: null }).branding, null)
  const withoutBranding = Object.fromEntries(Object.entries(ISSUER).filter(([field]) => field !== "branding"))
  assert.throws(() => decodeIssuer(withoutBranding), /invalid branding/u)
  assert.throws(() => decodeIssuerBranding(undefined), /invalid branding/u)
})
