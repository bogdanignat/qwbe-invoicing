import assert from "node:assert/strict"
import test from "node:test"

import { fiscalChangeOf, registryChecks, registryIssue, sameFiscalState } from "./fiscal-change.ts"
import type { IssuerProfile, VatChange } from "./issuer.ts"
import { scheduleVatRegistration } from "./vat-regime.ts"

const registered = (effectiveFrom: string): VatChange => ({ registered: true, effectiveFrom })
const nonVat = (effectiveFrom: string): VatChange => ({ registered: false, effectiveFrom, nonVatBasis: "article_310" })
const issuer = (change: VatChange, fiscalIdentifier = "12345674"): IssuerProfile => ({
  organizationId: "org-1", name: "Emitent SRL", fiscalIdentifier,
  address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" },
  legalForm: "srl", tradeRegistryNumber: "", iban: "", bankName: "", socialCapital: "",
  defaultCurrency: "RON", defaultPaymentTermDays: 15, branding: null,
  vatConfigurations: scheduleVatRegistration([], change),
})

void test("a save is a fiscal change when it moves the regime or the CIF, and not otherwise", () => {
  const existing = issuer(registered("2025-08-01"))
  assert.deepEqual(fiscalChangeOf(existing, "12345674", registered("2026-01-01")), { regimeFrom: undefined, cifChanged: false },
    "already registered on that day: nothing changes")
  assert.deepEqual(fiscalChangeOf(existing, "12345674", nonVat("2026-01-01")), { regimeFrom: "2026-01-01", cifChanged: false })
  assert.deepEqual(fiscalChangeOf(existing, "87654329", registered("2025-08-01")), { regimeFrom: undefined, cifChanged: true })
  assert.deepEqual(fiscalChangeOf(existing, "87654329", nonVat("2026-01-01")), { regimeFrom: "2026-01-01", cifChanged: true })
  assert.deepEqual(fiscalChangeOf(undefined, "12345674", registered("2025-08-01")), { regimeFrom: "2025-08-01", cifChanged: false },
    "the first configuration sets a regime; there is no earlier CIF to change")
})

void test("a new regime is checked on the day it starts and today; a new CIF alone, against the regime in force", () => {
  const existing = issuer(registered("2025-08-01"))
  const change = nonVat("2026-01-01")
  const scheduled = scheduleVatRegistration(existing.vatConfigurations, change)
  const regime = fiscalChangeOf(existing, "12345674", change)
  assert.deepEqual(registryChecks(regime, scheduled, change, "2026-09-01"),
    [{ date: "2026-01-01", registered: false }, { date: "2026-09-01", registered: false }])
  assert.deepEqual(registryChecks(regime, scheduled, change, "2026-01-01"), [{ date: "2026-01-01", registered: false }],
    "one question when the two days are the same")
  const cif = fiscalChangeOf(existing, "87654329", registered("2025-08-01"))
  assert.deepEqual(registryChecks(cif, existing.vatConfigurations, registered("2025-08-01"), "2026-09-01"),
    [{ date: "2026-09-01", registered: true }])
  const future = issuer(nonVat("2027-01-01"))
  assert.deepEqual(registryChecks(fiscalChangeOf(future, "87654329", nonVat("2027-01-01")), future.vatConfigurations,
    nonVat("2027-01-01"), "2026-09-01"), [{ date: "2027-01-01", registered: false }], "no regime today: the first one scheduled")
  assert.deepEqual(registryChecks(fiscalChangeOf(existing, "12345674", registered("2026-01-01")), existing.vatConfigurations,
    registered("2026-01-01"), "2026-09-01"), [])
})

void test("the registry refuses a regime it contradicts and a CIF it does not know, in Romanian", () => {
  const asRegistered = { date: "2026-01-01", registered: true }
  const asNonVat = { date: "2026-01-01", registered: false }
  assert.equal(registryIssue("12345674", asRegistered, "registered"), undefined)
  assert.equal(registryIssue("12345674", asNonVat, "not_registered"), undefined)
  assert.match(registryIssue("12345674", asRegistered, "not_registered") ?? "", /nu este înregistrat în scopuri de TVA la 2026-01-01/u)
  assert.match(registryIssue("12345674", asNonVat, "registered") ?? "", /este înregistrat în scopuri de TVA la 2026-01-01.*art\. 310/u)
  for (const check of [asRegistered, asNonVat]) {
    assert.match(registryIssue("12345674", check, "unknown_cif") ?? "", /nu figurează în registrul ANAF/u)
  }
})

void test("the fiscal state read again is compared field by field: CIF and every VAT period", () => {
  const existing = issuer(registered("2025-08-01"))
  assert.equal(sameFiscalState(existing, structuredClone(existing)), true)
  assert.equal(sameFiscalState(existing, { ...existing, name: "Alt nume SRL", iban: "RO49AAAA1B31007593840000" }), true)
  assert.equal(sameFiscalState(existing, { ...existing, fiscalIdentifier: "87654329" }), false)
  assert.equal(sameFiscalState(existing, { ...existing,
    vatConfigurations: scheduleVatRegistration(existing.vatConfigurations, nonVat("2026-01-01")) }), false)
  assert.equal(sameFiscalState(existing, { ...existing, vatConfigurations: existing.vatConfigurations.slice(1) }), false)
  assert.equal(sameFiscalState(undefined, undefined), true)
  assert.equal(sameFiscalState(undefined, existing), false)
})
