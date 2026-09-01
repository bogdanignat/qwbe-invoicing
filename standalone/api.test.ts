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
      taxIdentifier: " ro12345674 ",
      address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
      defaultCurrency: "RON",
      defaultPaymentTermDays: 15,
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
    const mismatchedIssuer = await handleApiRequest({
      method: "PUT",
      url: "/api/issuer",
      authorization,
      body: { ...issuerBody, taxIdentifier: "12345674" },
    }, runtime)
    assert.equal(mismatchedIssuer.status, 400)
    assert.deepEqual((mismatchedIssuer.body as { issues: ReadonlyArray<string> }).issues, [
      "taxIdentifier without RO prefix requires RO_NON_VAT with rate 0",
    ])
    const issuerAfterRejectedSave = await handleApiRequest({ method: "GET", url: "/api/issuer", authorization, body: undefined }, runtime)
    assert.equal(issuerAfterRejectedSave.status, 404)
    const issuer = await handleApiRequest({ method: "PUT", url: "/api/issuer", authorization, body: issuerBody }, runtime)
    assert.equal(issuer.status, 200)
    assert.equal((issuer.body as { taxIdentifier: string }).taxIdentifier, "RO12345674")
    const invoiceSeries = await handleApiRequest({
      method: "POST", url: "/api/document-series", authorization,
      body: { documentType: "invoice", series: "QWBE" },
    }, runtime)
    assert.equal(invoiceSeries.status, 200)
    const proformaSeries = await handleApiRequest({
      method: "POST", url: "/api/document-series", authorization,
      body: { documentType: "proforma", series: "PRO" },
    }, runtime)
    assert.equal(proformaSeries.status, 200)
    const series = await handleApiRequest({ method: "GET", url: "/api/document-series", authorization, body: undefined }, runtime)
    assert.deepEqual(series.body, [
      { organizationId: "org-1", documentType: "invoice", series: "QWBE" },
      { organizationId: "org-1", documentType: "proforma", series: "PRO" },
    ])
    const duplicateSeries = await handleApiRequest({
      method: "POST", url: "/api/document-series", authorization,
      body: { documentType: "invoice", series: "QWBE" },
    }, runtime)
    assert.deepEqual(duplicateSeries, { status: 409, body: { error: "DomainConflict", code: "document_series_exists" } })
    const rejectedUpdate = await handleApiRequest({
      method: "PUT",
      url: "/api/issuer",
      authorization,
      body: { ...issuerBody, taxIdentifier: "12345674" },
    }, runtime)
    assert.equal(rejectedUpdate.status, 400)
    const issuerAfterRejectedUpdate = await handleApiRequest({ method: "GET", url: "/api/issuer", authorization, body: undefined }, runtime)
    assert.equal((issuerAfterRejectedUpdate.body as { taxIdentifier: string }).taxIdentifier, "RO12345674")
    const customer = await handleApiRequest({
      method: "POST",
      url: "/api/customers",
      authorization,
      body: {
        legalName: "Ion Popescu",
        taxIdentifier: " ",
        address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2" },
      },
    }, runtime)
    assert.equal(customer.status, 200)
    assert.equal(typeof customer.body, "object")
    assert.equal((customer.body as { taxIdentifier: string }).taxIdentifier, "")
    const customerId = (customer.body as { id: string }).id

    const draft = await handleApiRequest({
      method: "POST",
      url: "/api/drafts",
      authorization,
      body: { customerId, issueDate: "2026-09-01", series: "QWBE" },
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
    const invoices = await handleApiRequest({
      method: "GET",
      url: "/api/invoices",
      authorization,
      body: undefined,
    }, runtime)
    assert.deepEqual(invoices.body, [issued.body])
    const payment = await handleApiRequest({
      method: "POST",
      url: `/api/invoices/${invoiceId}/payments`,
      authorization,
      body: { amount: "50.00", currency: "RON", paymentDate: "2026-09-02", method: "transfer" },
    }, runtime)
    assert.equal(payment.status, 200)
    assert.equal((payment.body as { status: string }).status, "partially_paid")
    const payments = await handleApiRequest({
      method: "GET",
      url: `/api/invoices/${invoiceId}/payments`,
      authorization,
      body: undefined,
    }, runtime)
    assert.deepEqual({
      status: (payments.body as { status: string }).status,
      paidAmount: (payments.body as { paidAmount: string }).paidAmount,
      remainingAmount: (payments.body as { remainingAmount: string }).remainingAmount,
      count: (payments.body as { payments: ReadonlyArray<unknown> }).payments.length,
    }, { status: "partially_paid", paidAmount: "50.00", remainingAmount: "71.00", count: 1 })
    const correction = await handleApiRequest({
      method: "POST",
      url: `/api/invoices/${invoiceId}/corrections`,
      authorization,
      body: { reason: "Corecție integrală de test", issueDate: "2026-09-03" },
    }, runtime)
    assert.equal(correction.status, 200)
    assert.equal((correction.body as { totalIncludingTax: string }).totalIncludingTax, "-121.00")
    const corrections = await handleApiRequest({
      method: "GET",
      url: `/api/invoices/${invoiceId}/corrections`,
      authorization,
      body: undefined,
    }, runtime)
    assert.equal((corrections.body as ReadonlyArray<unknown>).length, 1)
    const duplicateCorrection = await handleApiRequest({
      method: "POST",
      url: `/api/invoices/${invoiceId}/corrections`,
      authorization,
      body: { reason: "Corecție duplicată", issueDate: "2026-09-04" },
    }, runtime)
    assert.deepEqual(duplicateCorrection, {
      status: 409,
      body: { error: "DomainConflict", code: "invoice_already_corrected" },
    })
    const customers = await handleApiRequest({
      method: "GET",
      url: "/api/customers",
      authorization,
      body: undefined,
    }, runtime)
    assert.equal(customers.status, 200)
    assert.equal((customers.body as ReadonlyArray<unknown>).length, 1)
    const deletedCustomer = await handleApiRequest({
      method: "DELETE",
      url: `/api/customers/${customerId}`,
      authorization,
      body: undefined,
    }, runtime)
    assert.deepEqual(deletedCustomer, { status: 200, body: { deleted: true } })
    const customersAfterDelete = await handleApiRequest({
      method: "GET",
      url: "/api/customers",
      authorization,
      body: undefined,
    }, runtime)
    assert.deepEqual(customersAfterDelete.body, [])
    const preservedInvoice = await handleApiRequest({
      method: "GET",
      url: `/api/invoices/${invoiceId}`,
      authorization,
      body: undefined,
    }, runtime)
    assert.deepEqual(preservedInvoice.body, issued.body)
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
