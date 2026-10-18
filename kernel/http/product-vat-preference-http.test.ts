import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { Schema } from "effect"

import { handleApiRequest } from "../api/api.test-support.ts"
import { createRequestAuthenticator } from "../auth/auth.ts"
import { migratedFixture } from "../storage/postgres-rig.test-support.ts"
import * as S from "../api/http-schemas.ts"

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
const each = { code: "C62", name: "unitate" }
const book = { description: "Carte", unitPrice: "100", unitOfMeasure: each }
const reducedLine = { description: "Carte", quantity: "1", unitPrice: "100", unitOfMeasure: each, vatRateCode: "RO_REDUCED" }
const issueDate = "2026-09-16"
const fixture = async (label: string) => {
  const rig = await migratedFixture(`pvp_${label}`)
  const token = "p".repeat(64)
  const tokenFile = join(rig.dataDirectory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  const runtime = {
    pool: rig.pool,
    dataDirectory: rig.dataDirectory, now: () => new Date("2026-09-16T10:00:00.000Z"),
    authenticate: createRequestAuthenticator(rig.config({ authTokenFile: tokenFile })),
  }
  const call = (method: string, url: string, body?: unknown, idempotencyKey?: string) => handleApiRequest({
    method, url, authorization: `Bearer ${token}`, body, ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  }, runtime)
  const issue = (line: unknown, key: string) => call("POST", "/api/invoices", {
    customer: buyer, issueDate, dueDate: "2026-10-01", currency: "RON", series: "INV", lines: [line],
  }, key)
  return { call, issue, close: () => rig.close() }
}

void test("HTTP stores a product's preferred VAT code, clears it on a PUT without it and refuses bad codes", async () => {
  const value = await fixture("store")
  try {
    const created = await value.call("POST", "/api/product-presets", { ...book, preferredVatRateCode: "RO_REDUCED" })
    assert.equal(created.status, 200)
    const preset = Schema.decodeUnknownSync(S.ProductPreset)(created.body)
    assert.equal(preset.preferredVatRateCode, "RO_REDUCED")
    assert.deepEqual((await value.call("GET", "/api/product-presets")).body, { items: [created.body], nextCursor: null })
    for (const preferredVatRateCode of [21, null, "RO_NON_VAT", "RO_REDUCED_5", "RO_SUPER", ""]) {
      const response = await value.call("PUT", `/api/product-presets/${preset.id}`, { ...book, preferredVatRateCode })
      assert.equal(response.status, 400, JSON.stringify(preferredVatRateCode))
      assert.equal((await value.call("POST", "/api/product-presets", { ...book, preferredVatRateCode })).status, 400)
    }
    assert.deepEqual((await value.call("GET", "/api/product-presets")).body, { items: [created.body], nextCursor: null })
    const cleared = await value.call("PUT", `/api/product-presets/${preset.id}`, book)
    assert.equal(cleared.status, 200)
    assert.equal(Object.hasOwn(Schema.decodeUnknownSync(S.ProductPreset)(cleared.body), "preferredVatRateCode"), false)
  } finally { await value.close() }
})

void test("a reduced-rate line on a registered issuer yields an invoice at the rate in force on the issue date", async () => {
  const value = await fixture("resolve")
  try {
    const configured = await value.call("PUT", "/api/issuer", { ...issuer, vatChange: { registered: true, effectiveFrom: "2025-08-01" } })
    assert.equal(configured.status, 200)
    assert.equal((await value.call("POST", "/api/document-series", { documentType: "invoice", series: "INV" })).status, 200)
    const issued = await value.issue(reducedLine, "reduced-invoice")
    assert.equal(issued.status, 200)
    const invoice = Schema.decodeUnknownSync(S.IssuedInvoice)(issued.body)
    assert.equal(invoice.lines[0]?.vatRate, "11.00")
    assert.deepEqual(invoice.vatBreakdown.map(({ code, rate, vatBaseAmount, vatAmount, vatCategoryCode }) =>
      ({ code, rate, vatBaseAmount, vatAmount, vatCategoryCode })),
    [{ code: "RO_REDUCED", rate: "11.00", vatBaseAmount: "100.00", vatAmount: "11.00", vatCategoryCode: "S" }])
    assert.equal(invoice.totalIncludingVat, "111.00")
  } finally { await value.close() }
})

// The server knows nothing of product preferences: a line's code is checked against the
// issuer on the document date, and an Article 310 issuer cannot charge a taxable rate.
void test("an Article 310 issuer: the exemption is accepted, a reduced code sent directly is refused", async () => {
  const value = await fixture("issue")
  try {
    const configured = await value.call("PUT", "/api/issuer", {
      ...issuer, vatChange: { registered: false, effectiveFrom: "2025-08-01", nonVatBasis: "article_310" },
    })
    assert.equal(configured.status, 200)
    assert.equal((await value.call("POST", "/api/document-series", { documentType: "invoice", series: "INV" })).status, 200)
    const draft = await value.call("POST", "/api/drafts", { customer: buyer, issueDate, series: "INV" }, "vat-preference-draft-1")
    assert.equal(draft.status, 200)
    const draftId = Schema.decodeUnknownSync(S.DraftInvoice)(draft.body).id
    assert.equal((await value.call("POST", `/api/drafts/${draftId}/lines`, reducedLine)).status, 400)
    assert.deepEqual(Schema.decodeUnknownSync(S.DraftInvoice)((await value.call("GET", `/api/drafts/${draftId}`)).body).lines, [])
    assert.equal((await value.call("POST", `/api/drafts/${draftId}/lines`, { ...reducedLine, vatRateCode: "RO_NON_VAT" })).status, 200)
    assert.equal((await value.issue(reducedLine, "article310-reduced")).status, 400)
    assert.deepEqual((await value.call("GET", "/api/invoices")).body, { items: [], nextCursor: null })
    const issued = await value.issue({ ...reducedLine, vatRateCode: "RO_NON_VAT" }, "article310-exempt")
    assert.equal(issued.status, 200)
    const invoice = Schema.decodeUnknownSync(S.IssuedInvoice)(issued.body)
    assert.deepEqual(invoice.lines.map(({ vatCategoryCode, vatRate }) => ({ vatCategoryCode, vatRate })), [{ vatCategoryCode: "O", vatRate: "0.00" }])
    assert.equal(invoice.vatTotal, "0.00")
    assert.equal(invoice.totalIncludingVat, "100.00")
  } finally { await value.close() }
})
