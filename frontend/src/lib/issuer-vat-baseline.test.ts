import assert from "node:assert/strict"
import test from "node:test"

import {
  UNKNOWN_VAT_CHOICE_REQUIRED, UNKNOWN_VAT_STATUS, currentVatRegistration, issuerVatBaseline,
  issuerVatStatus, issuerVatSubmitIssue,
} from "./issuer-vat-baseline.ts"
import type { Issuer, VatConfiguration } from "./draft-models.ts"

const ARTICLE_310 = "Regim special de scutire conform art. 310 din Codul fiscal"

const standard = (effectiveFrom: string, effectiveTo?: string): VatConfiguration => ({
  code: "RO_STANDARD", rate: "21", vatCategoryCode: "S", vatExemptionReason: null,
  effectiveFrom, ...(effectiveTo === undefined ? {} : { effectiveTo }),
})

const reduced = (effectiveFrom: string, effectiveTo?: string): VatConfiguration => ({
  code: "RO_REDUCED", rate: "11", vatCategoryCode: "S", vatExemptionReason: null,
  effectiveFrom, ...(effectiveTo === undefined ? {} : { effectiveTo }),
})

const exempt = (effectiveFrom: string, effectiveTo?: string): VatConfiguration => ({
  code: "RO_NON_VAT", rate: "0", vatCategoryCode: "O", vatExemptionReason: ARTICLE_310,
  effectiveFrom, ...(effectiveTo === undefined ? {} : { effectiveTo }),
})

const issuerWith = (
  configurations: ReadonlyArray<VatConfiguration>,
  currentVat: Issuer["currentVat"],
): Issuer => ({
  organizationId: "org-1", name: "Firma Test SRL", fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "București", street: "Calea Victoriei 1", county: "RO-B", sector: 3 },
  legalForm: "srl", tradeRegistryNumber: "J40/1234/2020", iban: "RO49AAAA1B31007593840000",
  bankName: "Banca Test", socialCapital: "200.00", defaultCurrency: "RON", defaultPaymentTermDays: 15,
  vatConfigurations: configurations, currentVat, branding: null,
})

void test("current VAT registration — reads the regime in force from the configurations themselves", () => {
  assert.deepEqual(currentVatRegistration([standard("2026-08-01"), reduced("2026-08-01")], "2026-09-25"), {
    registered: true, effectiveFrom: "2026-08-01",
  })
  assert.deepEqual(currentVatRegistration([exempt("2026-01-01")], "2026-09-25"), {
    registered: false, effectiveFrom: "2026-01-01",
  })
})

void test("current VAT registration — dates the period by its earliest active rate, as the backend reports it", () => {
  // A catalogue change mid-regime gives one regime two start dates; the regime
  // began on the first of them, which is what `currentVat.effectiveFrom` says.
  const period = [standard("2026-01-01"), reduced("2026-08-01")]
  assert.deepEqual(currentVatRegistration(period, "2026-09-25"), { registered: true, effectiveFrom: "2026-01-01" })
})

void test("current VAT registration — answers nothing when the date is covered by no regime it can name", () => {
  assert.equal(currentVatRegistration([], "2026-09-25"), undefined)
  assert.equal(currentVatRegistration([standard("2026-10-01")], "2026-09-25"), undefined)
  assert.equal(currentVatRegistration([exempt("2026-01-01", "2026-08-31")], "2026-09-25"), undefined)
  assert.equal(currentVatRegistration([standard("2026-01-01"), exempt("2026-01-01")], "2026-09-25"), undefined)
})

void test("VAT baseline — a scheduled regime that came into force overnight wins over yesterday's cached snapshot", () => {
  // The tab was opened on 2026-09-30, when the registration was still scheduled:
  // the server answered `currentVat: null` and that answer is still cached. It is
  // 2026-10-01 now, the configurations cover today, and the form must say so.
  const issuer = issuerWith([standard("2026-10-01"), reduced("2026-10-01")], null)
  const baseline = issuerVatBaseline(issuer, "2026-10-01")
  assert.deepEqual(baseline, {
    kind: "known", selection: { registered: true, effectiveFrom: "2026-10-01" }, fallback: undefined,
  })
  assert.equal(issuerVatSubmitIssue(baseline, false), undefined)
})

void test("VAT baseline — a cached snapshot of the previous regime does not survive the day it expired", () => {
  // Same tab, opposite direction: the cached `currentVat` still says "registered
  // since 2026-01-01" while the exemption scheduled for today is the one in force.
  const stale = { registered: true, effectiveFrom: "2026-01-01" } as const
  const issuer = issuerWith([standard("2026-01-01", "2026-09-30"), exempt("2026-10-01")], stale)
  assert.deepEqual(issuerVatBaseline(issuer, "2026-10-01"), {
    kind: "known", selection: { registered: false, effectiveFrom: "2026-10-01" }, fallback: undefined,
  })
})

void test("VAT baseline — keeps the scheduled and expired fallback, with its timing and date", () => {
  const scheduled = issuerVatBaseline(issuerWith([exempt("2026-01-01", "2026-08-31"), standard("2026-10-01")], null), "2026-09-15")
  assert.equal(scheduled.kind, "known")
  assert.deepEqual(scheduled.selection, { registered: true, effectiveFrom: "2026-10-01" })
  assert.deepEqual(scheduled.fallback, { registered: true, effectiveFrom: "2026-10-01", timing: "scheduled" })

  const expired = issuerVatBaseline(issuerWith([exempt("2026-01-01", "2026-08-31")], null), "2026-09-15")
  assert.equal(expired.kind, "known")
  assert.deepEqual(expired.selection, { registered: false, effectiveFrom: "2026-01-01" })
  assert.equal(expired.fallback?.timing, "expired")
})

void test("VAT baseline — an issuer that was never saved opens on the default of a new profile", () => {
  const baseline = issuerVatBaseline(null, "2026-09-25")
  assert.deepEqual(baseline, {
    kind: "unsaved", selection: { registered: false, effectiveFrom: "2026-09-25" }, fallback: undefined,
  })
  assert.equal(issuerVatSubmitIssue(baseline, false), undefined)
  assert.equal(issuerVatStatus(baseline, baseline.selection, false), "Firma este configurată ca neplătitoare de TVA.")
})

void test("VAT baseline — a stored regime it cannot read is never turned into article 310 by a save", () => {
  // Configurations that name no regime today and none next to it either.
  const issuer = issuerWith([standard("2026-01-01"), exempt("2026-01-01")], null)
  const baseline = issuerVatBaseline(issuer, "2026-09-25")
  assert.equal(baseline.kind, "unknown")
  assert.equal(baseline.fallback, undefined)
  assert.equal(issuerVatSubmitIssue(baseline, false), UNKNOWN_VAT_CHOICE_REQUIRED)
  assert.equal(issuerVatStatus(baseline, baseline.selection, false), UNKNOWN_VAT_STATUS)
})

void test("VAT baseline — the save opens once the checkbox has actually been answered", () => {
  const baseline = issuerVatBaseline(issuerWith([standard("2026-01-01"), exempt("2026-01-01")], null), "2026-09-25")
  assert.equal(issuerVatSubmitIssue(baseline, true), undefined)
  assert.equal(
    issuerVatStatus(baseline, { registered: true, effectiveFrom: "2026-09-25" }, true),
    "Regimul plătitor de TVA a fost ales manual.",
  )
  assert.equal(
    issuerVatStatus(baseline, { registered: false, effectiveFrom: "2026-09-25" }, true),
    "Regimul neplătitor de TVA a fost ales manual.",
  )
})

void test("VAT status — a readable regime still reports the form against the saved profile", () => {
  const baseline = issuerVatBaseline(issuerWith([standard("2026-08-01")], null), "2026-09-25")
  assert.equal(issuerVatStatus(baseline, baseline.selection, false), "Firma este configurată ca plătitoare de TVA.")
  assert.equal(
    issuerVatStatus(baseline, { registered: false, effectiveFrom: "2026-09-25" }, true),
    "Regimul neplătitor de TVA a fost ales manual.",
  )
  assert.equal(
    issuerVatStatus(baseline, { registered: true, effectiveFrom: "2026-09-25" }, false),
    "Data schimbării regimului TVA a fost modificată.",
  )
})
