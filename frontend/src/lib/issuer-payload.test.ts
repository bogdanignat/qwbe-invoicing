import assert from "node:assert/strict"
import test from "node:test"

import { issuerPayload, type IssuerField } from "./issuer-payload.ts"
import type { BrandingImageDraft } from "./issuer-branding.ts"
import type { IssuerSettingsForm } from "./issuer-form.ts"

const FORM: IssuerSettingsForm = {
  name: "  Firma Test SRL  ",
  fiscalIdentifier: "12345674",
  legalForm: "srl",
  tradeRegistryNumber: "j40/1234/2020",
  city: " București ",
  street: " Calea Victoriei 1 ",
  county: "RO-B",
  sector: "3",
  postalCode: " 010061 ",
  socialCapital: "200",
  iban: "RO49 AAAA 1B31 0075 9384 0000",
  bankName: " Banca Test ",
  defaultPaymentTermDays: "30",
  vatRegistered: true,
  vatEffectiveFrom: "2026-08-01",
  brandText: " Marca ",
}

const IMAGE: BrandingImageDraft = {
  dataBase64: "AAA", previewUrl: "data:image/png;base64,AAA", width: 120, height: 40,
}

const refusal = (form: Partial<IssuerSettingsForm>): IssuerField | "ready" => {
  const validation = issuerPayload({ ...FORM, ...form }, null)
  return validation.kind === "ready" ? "ready" : validation.field
}

void test("issuer payload — sends every field of the profile the PUT replaces, normalized", () => {
  const validation = issuerPayload(FORM, null)
  assert.equal(validation.kind, "ready")
  assert.deepEqual(validation.payload, {
    name: "Firma Test SRL",
    fiscalIdentifier: "12345674",
    address: {
      countryCode: "RO", city: "București", street: "Calea Victoriei 1",
      county: "RO-B", sector: 3, postalCode: "010061",
    },
    legalForm: "srl",
    tradeRegistryNumber: "J40/1234/2020",
    iban: "RO49AAAA1B31007593840000",
    bankName: "Banca Test",
    socialCapital: "200.00",
    defaultCurrency: "RON",
    defaultPaymentTermDays: 30,
    vatChange: { registered: true, effectiveFrom: "2026-08-01" },
    branding: { text: "Marca", image: null },
  })
})

void test("issuer payload — sends the regime change, and the exemption basis when it is dropped", () => {
  const validation = issuerPayload({ ...FORM, vatRegistered: false, vatEffectiveFrom: "2026-09-25" }, null)
  assert.equal(validation.kind, "ready")
  assert.deepEqual(validation.payload.vatChange, {
    registered: false, effectiveFrom: "2026-09-25", nonVatBasis: "article_310",
  })
})

void test("issuer payload — omits an address field the profile has nothing to say about", () => {
  const validation = issuerPayload({ ...FORM, county: "RO-CJ", sector: "3", postalCode: "  " }, null)
  assert.equal(validation.kind, "ready")
  assert.deepEqual(validation.payload.address, {
    countryCode: "RO", city: "București", street: "Calea Victoriei 1", county: "RO-CJ",
  })
})

void test("issuer payload — keeps the chosen logo's bytes and its brand line together", () => {
  const withImage = issuerPayload(FORM, IMAGE)
  assert.equal(withImage.kind, "ready")
  assert.deepEqual(withImage.payload.branding, { text: "Marca", image: { dataBase64: "AAA" } })
  const textless = issuerPayload({ ...FORM, brandText: "   " }, IMAGE)
  assert.equal(textless.kind, "ready")
  assert.deepEqual(textless.payload.branding, { text: null, image: { dataBase64: "AAA" } })
})

void test("issuer payload — an empty brand text with no logo is no branding at all", () => {
  const validation = issuerPayload({ ...FORM, brandText: "   " }, null)
  assert.equal(validation.kind, "ready")
  assert.equal(validation.payload.branding, null)
})

void test("issuer payload — refuses each field with the sentence shown under it", () => {
  assert.deepEqual(issuerPayload({ ...FORM, name: "  " }, null), {
    kind: "issue", field: "name", message: "Denumirea legală este obligatorie.",
  })
  assert.deepEqual(issuerPayload({ ...FORM, fiscalIdentifier: "RO12345674" }, null), {
    kind: "issue", field: "fiscalIdentifier",
    message: "CUI-ul este numeric, fără prefixul RO, și nu începe cu zero.",
  })
  assert.deepEqual(issuerPayload({ ...FORM, sector: "7" }, null), {
    kind: "issue", field: "sector", message: "Adresele din București au un sector, de la 1 la 6.",
  })
  assert.deepEqual(issuerPayload({ ...FORM, defaultPaymentTermDays: "3651" }, null), {
    kind: "issue", field: "defaultPaymentTermDays",
    message: "Termenul de plată este un număr întreg de zile, între 0 și 3650.",
  })
  assert.deepEqual(issuerPayload({ ...FORM, vatEffectiveFrom: "" }, null), {
    kind: "issue", field: "vatEffectiveFrom", message: "Alege data de la care se aplică regimul TVA.",
  })
})

void test("issuer payload — names the first field that is wrong, in reading order", () => {
  const empty: Partial<IssuerSettingsForm> = {
    name: "", fiscalIdentifier: "0", legalForm: "", tradeRegistryNumber: "x",
    socialCapital: "x", iban: "x", bankName: "Banca\nTest", city: "", street: "", county: "",
    sector: "3", brandText: "Marca\nSRL", defaultPaymentTermDays: "x", vatEffectiveFrom: "",
  }
  const order: ReadonlyArray<IssuerField & keyof IssuerSettingsForm> = [
    "name", "fiscalIdentifier", "legalForm", "tradeRegistryNumber", "socialCapital", "iban",
    "bankName", "city", "street", "county", "brandText", "defaultPaymentTermDays", "vatEffectiveFrom",
  ]
  const seen = order.map((_field, index) => {
    const filled = Object.fromEntries(order.slice(0, index).map((earlier) => [earlier, FORM[earlier]]))
    return refusal({ ...empty, ...filled })
  })
  assert.deepEqual(seen, order)
})

void test("issuer payload — a sector is only refused where sectors exist", () => {
  assert.equal(refusal({ county: "RO-CJ", sector: "" }), "ready")
  assert.equal(refusal({ county: "RO-B", sector: "" }), "sector")
  assert.equal(refusal({ county: "RO-B", sector: "1.5" }), "sector")
})

void test("issuer payload — never refuses the logo: the image is refused while it is read", () => {
  assert.notEqual(refusal({}), "brandImage")
  assert.equal(issuerPayload(FORM, IMAGE).kind, "ready")
})
