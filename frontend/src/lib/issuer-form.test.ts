import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_PAYMENT_TERM_DAYS, changeIssuerIdentifier, changeVatRegistration, chooseIssuerCounty,
  editedIssuerForm, issuerFormOf, issuerSectorRequired, legalFormValue, vatSelectionOf,
  type IssuerSettingsForm,
} from "./issuer-form.ts"
import type { Issuer } from "./draft-models.ts"

const issuer: Issuer = {
  organizationId: "org-1",
  name: "Firma Test SRL",
  fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "București", street: "Calea Victoriei 1", county: "RO-B", sector: 3, postalCode: "010061" },
  legalForm: "srl",
  tradeRegistryNumber: "J40/1234/2020",
  iban: "RO49AAAA1B31007593840000",
  bankName: "Banca Test",
  socialCapital: "200.00",
  defaultCurrency: "RON",
  defaultPaymentTermDays: 30,
  vatConfigurations: [],
  currentVat: { registered: true, effectiveFrom: "2026-08-01" },
  branding: { text: "Marca", image: null },
}

const SELECTION = { registered: true, effectiveFrom: "2026-08-01" }

void test("issuer form — opens on the saved profile, with the address held as strings", () => {
  const form = issuerFormOf(issuer, SELECTION)
  assert.equal(form.sector, "3")
  assert.equal(form.postalCode, "010061")
  assert.equal(form.defaultPaymentTermDays, "30")
  assert.equal(form.brandText, "Marca")
  assert.deepEqual(vatSelectionOf(form), SELECTION)
})

void test("issuer form — opens a profile that does not exist yet on the defaults of a new one", () => {
  const form = issuerFormOf(null, { registered: false, effectiveFrom: "2026-09-25" })
  assert.equal(form.legalForm, "")
  assert.equal(form.sector, "")
  assert.equal(form.brandText, "")
  assert.equal(form.defaultPaymentTermDays, String(DEFAULT_PAYMENT_TERM_DAYS))
  assert.deepEqual(vatSelectionOf(form), { registered: false, effectiveFrom: "2026-09-25" })
})

void test("choosing a county — drops a sector the new county has no room for", () => {
  const form = issuerFormOf(issuer, SELECTION)
  assert.equal(issuerSectorRequired(form), true)
  const moved = chooseIssuerCounty(form, "RO-CJ")
  assert.equal(moved.sector, "")
  assert.equal(issuerSectorRequired(moved), false)
  assert.equal(chooseIssuerCounty(moved, "RO-B").sector, "")
  assert.equal(chooseIssuerCounty(form, "RO-B").sector, "3")
})

void test("identifier — keeps the digits of a pasted RO prefix and never touches the regime", () => {
  const form = issuerFormOf(issuer, SELECTION)
  assert.equal(changeIssuerIdentifier(form, "RO 12345674").fiscalIdentifier, "12345674")
  assert.equal(changeIssuerIdentifier(form, "ro12345674").fiscalIdentifier, "12345674")
  assert.equal(changeIssuerIdentifier(form, "RO 12345674").vatRegistered, true)
  assert.equal(changeIssuerIdentifier({ ...form, vatRegistered: false }, "12345674").vatRegistered, false)
})

void test("VAT choice — dates the change today", () => {
  const form = issuerFormOf(issuer, SELECTION)
  const changed = changeVatRegistration(form, false, "2026-09-25")
  assert.deepEqual(vatSelectionOf(changed), { registered: false, effectiveFrom: "2026-09-25" })
  assert.deepEqual(vatSelectionOf(changeVatRegistration(changed, true, "2026-09-26")), {
    registered: true, effectiveFrom: "2026-09-26",
  })
})

void test("legal form — only the two forms the profile accepts survive the select", () => {
  assert.equal(legalFormValue("srl"), "srl")
  assert.equal(legalFormValue("pfa"), "pfa")
  assert.equal(legalFormValue("sa"), "")
  assert.equal(legalFormValue(""), "")
})

// React applies the updaters queued in one batch in order, each on the state the
// previous one returned. `batched` is that, and nothing else.
const batched = (
  saved: IssuerSettingsForm,
  edits: ReadonlyArray<(form: IssuerSettingsForm) => IssuerSettingsForm>,
): IssuerSettingsForm => edits.reduce<IssuerSettingsForm | undefined>(
  (current, edit) => editedIssuerForm(current, saved, edit), undefined) ?? saved

void test("edited form — an autofill that patches three fields in one batch keeps all three", () => {
  const saved = issuerFormOf(null, { registered: false, effectiveFrom: "2026-09-25" })
  const autofill = [{ city: "Cluj-Napoca" }, { street: "Str. Memorandumului 1" }, { postalCode: "400114" }]
  const filled = batched(saved, autofill.map((patch) => (form: IssuerSettingsForm) => ({ ...form, ...patch })))
  assert.equal(filled.city, "Cluj-Napoca")
  assert.equal(filled.street, "Str. Memorandumului 1")
  assert.equal(filled.postalCode, "400114")
})

void test("edited form — the first edit starts from the saved profile, the next from the one before it", () => {
  const saved = issuerFormOf(issuer, SELECTION)
  const first = editedIssuerForm(undefined, saved, (form) => chooseIssuerCounty(form, "RO-CJ"))
  assert.equal(first.city, "București")
  assert.equal(first.sector, "")
  const second = editedIssuerForm(first, saved, (form) => ({ ...form, city: "Cluj-Napoca" }))
  assert.equal(second.city, "Cluj-Napoca")
  assert.equal(second.sector, "", "the county already chosen in this batch must not be read back from the saved profile")
})

void test("edited form — a county and an identifier typed in one batch do not overwrite each other", () => {
  const saved = issuerFormOf(issuer, SELECTION)
  const typed = batched(saved, [
    (form) => chooseIssuerCounty(form, "RO-CJ"),
    (form) => changeIssuerIdentifier(form, "RO 12345674"),
  ])
  assert.equal(typed.county, "RO-CJ")
  assert.equal(typed.fiscalIdentifier, "12345674")
})
