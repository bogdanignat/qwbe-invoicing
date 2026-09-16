import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { handleApiRequest } from "./api.test-support.ts"
import { createRequestAuthenticator } from "./auth.ts"
import { applyMigrations } from "./migrations.ts"

void test("direct proforma authoring needs only a proforma series configuration", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-proforma-api-"))
  const token = "p".repeat(64)
  const tokenFile = join(directory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  try {
    applyMigrations(directory)
    const authorization = `Bearer ${token}`
    const runtime = {
      authenticate: createRequestAuthenticator({ host: "127.0.0.1", port: 3000, dataDirectory: directory,
        nodeEnvironment: "test", authTokenFile: tokenFile, organizationId: "org-1" }),
      dataDirectory: directory,
      now: () => new Date("2026-09-05T10:00:00.000Z"),
    }
    const issuer = await handleApiRequest({ method: "PUT", url: "/api/issuer", authorization, body: {
      name: "Furnizor SRL", fiscalIdentifier: "12345674",
      address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" }, legalForm: "srl",
      tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca",
      socialCapital: "1000", defaultCurrency: "RON", defaultPaymentTermDays: 15,
      vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null,
    } }, runtime)
    assert.equal(issuer.status, 200)
    assert.equal((await handleApiRequest({ method: "POST", url: "/api/document-series", authorization,
      body: { documentType: "proforma", series: "PRO" } }, runtime)).status, 200)

    const created = await handleApiRequest({ method: "POST", url: "/api/proformas", authorization,
      idempotencyKey: "proforma-without-invoice-series", body: {
        customer: { partyType: "company", name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
          address: { countryCode: "RO", city: "Iași", street: "Strada 2", county: "RO-IS" } },
        proformaSeries: "PRO", issueDate: "2026-09-05", dueDate: "2026-09-20", currency: "RON",
        lines: [{ description: "Servicii", quantity: "1", unitPrice: "100", unitOfMeasure: { code: "HUR", name: "oră" },
          vatRateCode: "RO_STANDARD" }],
      } }, runtime)
    assert.equal(created.status, 200)
    assert.equal((created.body as { series: string }).series, "PRO")
    assert.equal(Object.hasOwn(created.body as object, "invoiceSeries"), false)
    const id = (created.body as { id: string }).id
    assert.deepEqual((await handleApiRequest({ method: "GET", url: `/api/proformas/${id}`, authorization, body: undefined }, runtime)).body,
      created.body)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
