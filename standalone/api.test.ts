import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { handleApiRequest } from "./api.ts"
import { createRequestAuthenticator } from "./auth.ts"
import { applyMigrations } from "./migrations.ts"

void test("requires host authentication and serves the complete invoice-core route sequence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-api-"))
  const token = "a".repeat(64)
  const tokenFile = join(directory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  try {
    applyMigrations(directory)
    const runtime = {
      authenticate: createRequestAuthenticator({
        host: "127.0.0.1",
        port: 3000,
        dataDirectory: directory,
        nodeEnvironment: "test",
        authTokenFile: tokenFile,
        organizationId: "org-1",
      }),
      dataDirectory: directory,
    }
    const issuerBody = {
      legalName: "Exemplu SRL",
      taxIdentifier: "RO12345678",
      address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
      defaultCurrency: "RON",
      defaultPaymentTermDays: 15,
      defaultSeries: "QWBE",
      taxConfigurations: [{
        code: "RO_STANDARD",
        category: "standard",
        rate: "21.00",
        effectiveFrom: "2025-08-01",
      }],
    }
    const denied = await handleApiRequest({
      method: "PUT",
      url: "/api/issuer",
      authorization: undefined,
      body: issuerBody,
    }, runtime)
    assert.equal(denied.status, 401)

    const authorization = `Bearer ${token}`
    const issuer = await handleApiRequest({ method: "PUT", url: "/api/issuer", authorization, body: issuerBody }, runtime)
    assert.equal(issuer.status, 200)
    const customer = await handleApiRequest({
      method: "POST",
      url: "/api/customers",
      authorization,
      body: {
        legalName: "Client SRL",
        taxIdentifier: "RO87654321",
        address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2" },
      },
    }, runtime)
    assert.equal(customer.status, 200)
    assert.equal(typeof customer.body, "object")
    const customerId = (customer.body as { id: string }).id

    const draft = await handleApiRequest({
      method: "POST",
      url: "/api/drafts",
      authorization,
      body: { customerId, issueDate: "2026-09-01" },
    }, runtime)
    assert.equal(draft.status, 200)
    const draftId = (draft.body as { id: string }).id
    const line = await handleApiRequest({
      method: "POST",
      url: `/api/drafts/${draftId}/lines`,
      authorization,
      body: { description: "Servicii", quantity: "1", unitPrice: "100", taxCode: "RO_STANDARD" },
    }, runtime)
    assert.equal(line.status, 200)
    const issued = await handleApiRequest({
      method: "POST",
      url: `/api/drafts/${draftId}/issue`,
      authorization,
      body: {},
    }, runtime)
    assert.equal(issued.status, 200)
    assert.equal((issued.body as { totalIncludingTax: string }).totalIncludingTax, "121.00")
    const invoiceId = (issued.body as { id: string }).id
    const fetched = await handleApiRequest({
      method: "GET",
      url: `/api/invoices/${invoiceId}`,
      authorization,
      body: undefined,
    }, runtime)
    assert.deepEqual(fetched.body, issued.body)
    const rendered = await handleApiRequest({
      method: "POST",
      url: `/api/invoices/${invoiceId}/pdf`,
      authorization,
      body: {},
    }, runtime)
    assert.equal(rendered.status, 200)
    const pdf = await handleApiRequest({
      method: "GET",
      url: `/api/invoices/${invoiceId}/pdf`,
      authorization,
      body: undefined,
    }, runtime)
    assert.equal(pdf.status, 200)
    assert.equal(pdf.body instanceof Uint8Array, true)
    assert.equal(pdf.headers?.["content-type"], "application/pdf")
    assert.equal(pdf.headers["x-content-type-options"], "nosniff")
    assert.equal(Buffer.from((pdf.body as Uint8Array).subarray(0, 5)).toString("ascii"), "%PDF-")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

void test("authenticates before parsing protected request bodies", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-api-shape-"))
  try {
    applyMigrations(directory)
    const response = await handleApiRequest({
      method: "POST",
      url: "/api/customers",
      authorization: undefined,
      body: [],
    }, {
      authenticate: createRequestAuthenticator({
        host: "127.0.0.1",
        port: 3000,
        dataDirectory: directory,
        nodeEnvironment: "test",
        authTokenFile: undefined,
        organizationId: "org-1",
      }),
      dataDirectory: directory,
    })
    assert.equal(response.status, 401)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
