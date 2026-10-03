import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { Schema } from "effect"

import { handleApiRequest } from "../api/api.test-support.ts"
import { createRequestAuthenticator } from "../auth/auth.ts"
import { migratedFixture } from "../storage/postgres-rig.test-support.ts"
import * as S from "../api/http-schemas.ts"
import { decodeInvoice, decodeIssuer, decodeVatCatalogue } from "../../web/src/lib/models.ts"
import { issuerForIssueDate, vatRatesForIssuer, vatRegistrationHistory } from "../../web/src/lib/vat-defaults.ts"
import { vatChangeFromSelection } from "../../web/src/lib/issuer-settings-state.ts"

const reason = "Regim special de scutire conform art. 310 din Codul fiscal"
const issuer = {
  name: "Firma Test SRL", fiscalIdentifier: "12345674", legalForm: "srl",
  address: { countryCode: "RO", city: "Iași", street: "Strada Test 1", county: "RO-IS" },
  tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca Test",
  socialCapital: "1000", defaultCurrency: "RON", defaultPaymentTermDays: 15, branding: null,
}
const buyer = {
  name: "Client Test", partyType: "individual", fiscalIdentifier: "", vatRegistered: false,
  address: { countryCode: "RO", city: "Iași", street: "Strada Test 2", county: "RO-IS" },
}
const fixture = async (label: string) => {
  const rig = await migratedFixture(`vth_${label}`)
  const token = "v".repeat(64)
  const tokenFile = join(rig.dataDirectory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  let date = "2026-09-16"
  const runtime = {
    pool: rig.pool,
    dataDirectory: rig.dataDirectory, now: () => new Date(`${date}T10:00:00.000Z`),
    authenticate: createRequestAuthenticator(rig.config({ authTokenFile: tokenFile })),
  }
  const call = (method: string, url: string, body?: unknown, idempotencyKey?: string) => handleApiRequest({
    method, url, authorization: `Bearer ${token}`, body, ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  }, runtime)
  // Each row as its own JSON, ordered by that JSON: a total order over three
  // tables with different keys, where SQLite leaned on `rowid`.
  const state = () => Promise.all(["issuers", "issuer_tax_configurations", "audit_events"].map((table) =>
    rig.sql.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)))
  return { call, state, advance: () => { date = "2026-09-17" }, close: () => rig.close() }
}

void test("HTTP rejects incompatible VAT basis before stripping fields, without writes or audit", async () => {
  const value = await fixture("basis")
  try {
    const before = await value.state()
    for (const vatChange of [
      { registered: true, nonVatBasis: "article_310" },
      { registered: true, nonVatBasis: null },
      { registered: false },
      { registered: false, nonVatBasis: "unknown" },
      { registered: false, nonVatBasis: null },
    ]) {
      const response = await value.call("PUT", "/api/issuer", { ...issuer, vatChange: { ...vatChange, effectiveFrom: "2025-08-01" } })
      assert.equal(response.status, 400, JSON.stringify(vatChange))
      assert.deepEqual(await value.state(), before)
    }
    const valid = await value.call("PUT", "/api/issuer", {
      ...issuer, vatChange: { registered: true, effectiveFrom: "2025-08-01", extra: "ignored" },
    })
    assert.equal(valid.status, 200)
    const saved = Schema.decodeUnknownSync(S.Issuer)(valid.body)
    assert.equal(saved.currentVat?.registered, true)
    assert.equal(Object.hasOwn(saved.currentVat, "nonVatBasis"), false)
    assert.ok(saved.vatConfigurations.every((vat) => vat.vatCategoryCode === "S" && vat.vatExemptionReason === null))
  } finally { await value.close() }
})

void test("HTTP preserves explicit article310 facts through query, proforma conversion, profile changes and storno", async () => {
  const value = await fixture("history")
  try {
    const configured = await value.call("PUT", "/api/issuer", {
      ...issuer, vatChange: vatChangeFromSelection({ registered: false, effectiveFrom: "2025-08-01" }),
    })
    assert.equal(configured.status, 200)
    const saved = Schema.decodeUnknownSync(S.Issuer)(configured.body)
    assert.equal(saved.currentVat?.nonVatBasis, "article_310")
    assert.equal(saved.vatConfigurations[0]?.vatExemptionReason, reason)
    assert.deepEqual((await value.call("GET", "/api/issuer")).body, configured.body)
    const catalogue = decodeVatCatalogue((await value.call("GET", "/api/vat-regimes")).body)
    assert.ok(catalogue.rates.some((vat) => vat.vatCategoryCode === "O" && vat.vatExemptionReason === reason))
    for (const [documentType, series] of [["invoice", "INV"], ["proforma", "PRO"]]) {
      assert.equal((await value.call("POST", "/api/document-series", { documentType, series })).status, 200)
    }
    const line = { description: "Serviciu test", quantity: "1", unitPrice: "100", unitOfMeasure: { code: "HUR", name: "oră" }, vatRateCode: "RO_NON_VAT" }
    const input = { customer: buyer, issueDate: "2026-09-16", dueDate: "2026-10-01", currency: "RON", lines: [line, line] }
    const issued = await value.call("POST", "/api/invoices", { ...input, series: "INV" }, "article310-invoice")
    assert.equal(issued.status, 200)
    const invoice = Schema.decodeUnknownSync(S.IssuedInvoice)(issued.body)
    assert.equal(invoice.vatBreakdown.length, 1)
    assert.equal(invoice.vatBreakdown[0]?.vatExemptionReason, reason)
    assert.equal(invoice.vatBreakdown[0].vatCategoryCode, "O")
    assert.equal(invoice.vatTotal, "0.00")
    assert.equal(invoice.totalIncludingVat, "200.00")
    assert.ok(invoice.lines.every((entry) => entry.vatCategoryCode === "O" && entry.vatRate === "0.00"))
    assert.doesNotThrow(() => decodeInvoice(issued.body))
    const offered = await value.call("POST", "/api/proformas", { ...input, proformaSeries: "PRO" }, "article310-proforma")
    assert.equal(offered.status, 200)
    const proforma = Schema.decodeUnknownSync(S.Proforma)(offered.body)
    const converted = await value.call("POST", `/api/proformas/${proforma.id}/invoice`, { invoiceSeries: "INV" }, "article310-conversion")
    assert.equal(converted.status, 200)
    assert.deepEqual(Schema.decodeUnknownSync(S.IssuedInvoice)(converted.body).vatBreakdown, invoice.vatBreakdown)
    value.advance()
    assert.equal((await value.call("PUT", "/api/issuer", {
      ...issuer, name: "Firma Test Actualizată", vatChange: { registered: true, effectiveFrom: "2026-09-17" },
    })).status, 200)
    assert.deepEqual((await value.call("GET", `/api/invoices/${invoice.id}`)).body, issued.body)
    const corrected = await value.call("POST", `/api/invoices/${invoice.id}/corrections`, { reason: "Anulare test" }, "article310-storno")
    assert.equal(corrected.status, 200)
    const correction = Schema.decodeUnknownSync(S.Correction)(corrected.body)
    assert.equal(correction.vatBreakdown[0]?.vatExemptionReason, reason)
    assert.equal(correction.vatBreakdown[0].vatCategoryCode, "O")
    assert.equal(correction.vatTotal, "0.00")
    assert.equal(correction.totalIncludingVat, "-200.00")
  } finally { await value.close() }
})

void test("complete historical server schedule stays registered in settings and dated authoring", async () => {
  const value = await fixture("issue")
  try {
    const saved = await value.call("PUT", "/api/issuer", {
      ...issuer, vatChange: { registered: true, effectiveFrom: "2025-01-01" },
    })
    assert.equal(saved.status, 200)
    const profile = decodeIssuer(saved.body)
    const catalogue = decodeVatCatalogue((await value.call("GET", "/api/vat-regimes")).body)
    const history = vatRegistrationHistory(profile.vatConfigurations, catalogue)
    assert.equal(history.length, 2)
    assert.ok(history.every((entry) => entry.registered))
    assert.deepEqual(vatRatesForIssuer(catalogue, profile, "2025-06-01").map(({ rate }) => rate), ["19.00", "9.00", "5.00"])
    assert.equal(issuerForIssueDate(profile, "2025-06-01").vatRegistered, true)
    assert.equal(issuerForIssueDate(profile, "2026-09-16").vatRegistered, true)
  } finally { await value.close() }
})
