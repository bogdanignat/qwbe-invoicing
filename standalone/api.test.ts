import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { handleApiRequest } from "./api.ts"
import { createRequestAuthenticator } from "./auth.ts"
import { applyMigrations } from "./migrations.ts"
const each = { code: "C62", name: "unitate" } as const

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
    const invalidCategory = await handleApiRequest({
      method: "PUT",
      url: "/api/issuer",
      authorization,
      body: {
        ...issuerBody,
        taxConfigurations: [{ ...issuerBody.taxConfigurations[0], category: "reduced" }],
      },
    }, runtime)
    assert.deepEqual(invalidCategory, {
      status: 400,
      body: { error: "ValidationFailure", issues: ["taxConfigurations.category must be standard"] },
    })
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
    const unitOfMeasures = await handleApiRequest({ method: "GET", url: "/api/unit-of-measures", authorization, body: undefined }, runtime)
    assert.equal(unitOfMeasures.status, 200)
    assert.equal((unitOfMeasures.body as ReadonlyArray<{ code: string }>).some(({ code }) => code === "HUR"), true)
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
        partyType: "individual",
        legalName: "Ion Popescu",
        taxIdentifier: " ",
        address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2" },
        defaultPaymentTermDays: 7,
      },
    }, runtime)
    assert.equal(customer.status, 200)
    assert.equal(typeof customer.body, "object")
    assert.equal((customer.body as { taxIdentifier: string }).taxIdentifier, "")
    assert.equal((customer.body as { defaultPaymentTermDays: number }).defaultPaymentTermDays, 7)
    const companyWithoutCui = await handleApiRequest({
      method: "POST", url: "/api/customers", authorization,
      body: { partyType: "company", legalName: "Fără CUI SRL", taxIdentifier: "", address: { countryCode: "RO", city: "Iași", street: "Strada 2" } },
    }, runtime)
    assert.equal(companyWithoutCui.status, 400)
    assert.equal((companyWithoutCui.body as { issues: ReadonlyArray<string> }).issues.includes("taxIdentifier is required for company"), true)
    const draftWithoutCui = await handleApiRequest({
      method: "POST", url: "/api/drafts", authorization,
      body: { customer: { partyType: "company", legalName: "Fără CUI SRL", taxIdentifier: "", address: { countryCode: "RO", city: "Iași", street: "Strada 2" } }, issueDate: "2026-09-01", series: "QWBE" },
    }, runtime)
    assert.equal(draftWithoutCui.status, 400)
    const customerId = (customer.body as { id: string }).id
    const updatedCustomer = await handleApiRequest({
      method: "PUT", url: `/api/customers/${customerId}`, authorization,
      body: { partyType: "individual", legalName: "Ion Actualizat", taxIdentifier: "",
        address: { countryCode: "RO", city: "Iași", street: "Strada Nouă 3" }, defaultPaymentTermDays: 21 },
    }, runtime)
    assert.equal(updatedCustomer.status, 200)
    assert.equal((updatedCustomer.body as { defaultPaymentTermDays: number }).defaultPaymentTermDays, 21)
    assert.equal((await handleApiRequest({ method: "PUT", url: "/api/customers/missing", authorization,
      body: customer.body }, runtime)).status, 404)

    const invalidPreset = await handleApiRequest({ method: "POST", url: "/api/product-presets", authorization,
      body: { description: " ", unitPrice: "1.00", unitOfMeasure: each } }, runtime)
    assert.equal(invalidPreset.status, 400)
    const preset = await handleApiRequest({ method: "POST", url: "/api/product-presets", authorization,
      body: { description: "  Consultanță  ", unitPrice: "10.5", unitOfMeasure: each } }, runtime)
    assert.equal(preset.status, 200)
    assert.equal((preset.body as { description: string }).description, "Consultanță")
    assert.equal((preset.body as { unitPrice: string }).unitPrice, "10.50")
    const presetId = (preset.body as { id: string }).id
    assert.equal((await handleApiRequest({ method: "PUT", url: `/api/product-presets/${presetId}`, authorization,
      body: { description: "Audit", unitPrice: "1.001", unitOfMeasure: each } }, runtime)).status, 400)
    const updatedPreset = await handleApiRequest({ method: "PUT", url: `/api/product-presets/${presetId}`, authorization,
      body: { description: "Audit", unitPrice: "20", unitOfMeasure: each } }, runtime)
    assert.equal((updatedPreset.body as { unitPrice: string }).unitPrice, "20.00")
    assert.deepEqual((await handleApiRequest({ method: "GET", url: "/api/product-presets", authorization,
      body: undefined }, runtime)).body, [updatedPreset.body])
    assert.deepEqual(await handleApiRequest({ method: "DELETE", url: `/api/product-presets/${presetId}`, authorization,
      body: undefined }, runtime), { status: 200, body: { deleted: true } })
    assert.equal((await handleApiRequest({ method: "DELETE", url: `/api/product-presets/${presetId}`, authorization,
      body: undefined }, runtime)).status, 404)

    const draft = await handleApiRequest({
      method: "POST",
      url: "/api/drafts",
      authorization,
      body: { customerId, issueDate: "2026-09-01", series: "QWBE" },
    }, runtime)
    assert.equal(draft.status, 200)
    const draftId = (draft.body as { id: string }).id
    assert.equal((draft.body as { customer: { partyType: string } }).customer.partyType, "individual")
    assert.equal((draft.body as { totalIncludingTax: string }).totalIncludingTax, "0.00")
    assert.equal((draft.body as { dueDate: string | null }).dueDate, null)
    const invalidDueDate = await handleApiRequest({
      method: "POST", url: "/api/drafts", authorization,
      body: { customerId, issueDate: "2026-09-01", series: "QWBE", dueDate: 7 },
    }, runtime)
    assert.equal(invalidDueDate.status, 400)
    const ambiguousBuyer = await handleApiRequest({
      method: "POST", url: "/api/drafts", authorization,
      body: { customerId, customer: customer.body, issueDate: "2026-09-01", series: "QWBE" },
    }, runtime)
    assert.equal(ambiguousBuyer.status, 400)
    const disposable = await handleApiRequest({
      method: "POST", url: "/api/drafts", authorization,
      body: { customer: { partyType: "individual", legalName: "Client unic", taxIdentifier: "", address: { countryCode: "RO", city: "Iași", street: "Strada 3" } }, issueDate: "2026-09-01", series: "QWBE" },
    }, runtime)
    const disposableId = (disposable.body as { id: string }).id
    const drafts = await handleApiRequest({ method: "GET", url: "/api/drafts", authorization, body: undefined }, runtime)
    assert.equal((drafts.body as ReadonlyArray<unknown>).length, 2)
    assert.deepEqual(await handleApiRequest({ method: "DELETE", url: `/api/drafts/${disposableId}`, authorization, body: undefined }, runtime), {
      status: 200, body: { deleted: true },
    })
    const updatedDraft = await handleApiRequest({
      method: "PUT", url: `/api/drafts/${draftId}`, authorization,
      body: { customer: { partyType: "individual", legalName: "Maria Ionescu", taxIdentifier: "", address: { countryCode: "RO", city: "Iași", street: "Strada Nouă 4" } }, issueDate: "2026-09-01", dueDate: "2026-09-20" },
    }, runtime)
    assert.equal((updatedDraft.body as { customer: { legalName: string } }).customer.legalName, "Maria Ionescu")
    const line = await handleApiRequest({
      method: "POST",
      url: `/api/drafts/${draftId}/lines`,
      authorization,
      body: { description: "Servicii", quantity: "1", unitPrice: "100", unitOfMeasure: each, taxCode: "RO_STANDARD" },
    }, runtime)
    assert.equal(line.status, 200)
    const lineId = (line.body as { lines: ReadonlyArray<{ id: string }> }).lines[0]?.id as string
    const editedLine = await handleApiRequest({
      method: "PUT", url: `/api/drafts/${draftId}/lines/${lineId}`, authorization,
      body: { description: "Servicii extinse", quantity: "2", unitPrice: "100", unitOfMeasure: each, taxCode: "RO_STANDARD" },
    }, runtime)
    assert.equal((editedLine.body as { totalIncludingTax: string }).totalIncludingTax, "242.00")
    const cleared = await handleApiRequest({
      method: "DELETE", url: `/api/drafts/${draftId}/lines/${lineId}`, authorization, body: undefined,
    }, runtime)
    assert.equal((cleared.body as { totalIncludingTax: string }).totalIncludingTax, "0.00")
    await handleApiRequest({
      method: "POST", url: `/api/drafts/${draftId}/lines`, authorization,
      body: { description: "Servicii", quantity: "1", unitPrice: "100", unitOfMeasure: each, taxCode: "RO_STANDARD" },
    }, runtime)
    const issued = await handleApiRequest({
      method: "POST",
      url: `/api/drafts/${draftId}/issue`,
      authorization,
      idempotencyKey: "draft-invoice-1",
      body: {},
    }, runtime)
    assert.equal(issued.status, 200)
    assert.equal((issued.body as { totalIncludingTax: string }).totalIncludingTax, "121.00")
    assert.equal((issued.body as { customer: { legalName: string } }).customer.legalName, "Maria Ionescu")
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
    assert.deepEqual(await handleApiRequest({
      method: "DELETE", url: `/api/invoices/${invoiceId}`, authorization, body: undefined,
    }, runtime), { status: 405, body: { error: "method_not_allowed" } })
    assert.equal((await handleApiRequest({
      method: "DELETE", url: `/api/drafts/${draftId}`, authorization, body: undefined,
    }, runtime)).status, 409)
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
    const proformaDraft = await handleApiRequest({
      method: "POST", url: "/api/drafts", authorization,
      body: { customerId, issueDate: "2026-09-05", dueDate: null, series: "QWBE",
        source: { app: "crm", kind: "offer", id: "offer-1" } },
    }, runtime)
    const proformaDraftId = (proformaDraft.body as { id: string }).id
    assert.deepEqual((await handleApiRequest({ method: "GET",
      url: "/api/drafts?sourceApp=crm&sourceKind=offer&sourceId=offer-1", authorization, body: undefined }, runtime)).body,
    [proformaDraft.body])
    await handleApiRequest({
      method: "POST", url: `/api/drafts/${proformaDraftId}/lines`, authorization,
      body: { description: "Avans", quantity: "1", unitPrice: "50", unitOfMeasure: each, taxCode: "RO_STANDARD" },
    }, runtime)
    assert.equal((await handleApiRequest({
      method: "POST", url: `/api/drafts/${proformaDraftId}/proformas`, authorization, body: { series: 7 },
    }, runtime)).status, 400)
    const proforma = await handleApiRequest({
      method: "POST", url: `/api/drafts/${proformaDraftId}/proformas`, authorization, idempotencyKey: "draft-proforma-1", body: { series: "PRO" },
    }, runtime)
    assert.equal(proforma.status, 200)
    assert.deepEqual((proforma.body as { source?: unknown }).source, { app: "crm", kind: "offer", id: "offer-1" })
    assert.equal((proforma.body as { dueDate: string | null }).dueDate, null)
    assert.equal((proforma.body as { convertedDraftId: string | null }).convertedDraftId, null)
    const proformaId = (proforma.body as { id: string }).id
    assert.deepEqual(await handleApiRequest({
      method: "POST", url: `/api/drafts/${proformaDraftId}/proformas`, authorization, idempotencyKey: "draft-proforma-2", body: { series: "PRO" },
    }, runtime), { status: 409, body: { error: "DomainConflict", code: "draft_already_issued" } })
    const sealedSource = await handleApiRequest({
      method: "GET", url: `/api/drafts/${proformaDraftId}`, authorization, body: undefined,
    }, runtime)
    assert.equal(sealedSource.status, 200)
    assert.equal((sealedSource.body as { status: string }).status, "proforma_issued")
    assert.deepEqual(await handleApiRequest({
      method: "DELETE", url: `/api/drafts/${proformaDraftId}`, authorization, body: undefined,
    }, runtime), { status: 409, body: { error: "DomainConflict", code: "draft_already_issued" } })
    assert.deepEqual((await handleApiRequest({ method: "GET", url: "/api/proformas", authorization, body: undefined }, runtime)).body, [proforma.body])
    assert.deepEqual((await handleApiRequest({ method: "GET",
      url: "/api/proformas?sourceApp=crm&sourceKind=offer&sourceId=offer-1", authorization, body: undefined }, runtime)).body,
    [proforma.body])
    assert.deepEqual((await handleApiRequest({ method: "GET", url: `/api/proformas/${proformaId}`, authorization, body: undefined }, runtime)).body, proforma.body)
    assert.equal((await handleApiRequest({ method: "GET", url: "/api/proformas/missing", authorization, body: undefined }, runtime)).status, 404)
    assert.equal((await handleApiRequest({ method: "POST", url: "/api/proformas/missing/invoice", authorization, idempotencyKey: "missing-proforma", body: {} }, runtime)).status, 404)
    assert.equal((await handleApiRequest({ method: "POST", url: `/api/proformas/${proformaId}/invoice`, authorization, body: [] }, runtime)).status, 400)
    assert.equal((await handleApiRequest({ method: "POST", url: "/api/proformas/missing/pdf", authorization, body: {} }, runtime)).status, 404)
    assert.equal((await handleApiRequest({ method: "GET", url: "/api/proformas/missing/pdf", authorization, body: undefined }, runtime)).status, 404)
    assert.equal((await handleApiRequest({ method: "POST", url: `/api/proformas/${proformaId}/pdf`, authorization, body: [] }, runtime)).status, 400)
    const renderedProforma = await handleApiRequest({
      method: "POST", url: `/api/proformas/${proformaId}/pdf`, authorization, body: {},
    }, runtime)
    assert.equal(renderedProforma.status, 200)
    assert.equal((renderedProforma.body as { proformaId: string; templateVersion: string }).proformaId, proformaId)
    assert.equal((renderedProforma.body as { templateVersion: string }).templateVersion, "proforma-v1")
    assert.deepEqual((await handleApiRequest({
      method: "POST", url: `/api/proformas/${proformaId}/pdf`, authorization, body: {},
    }, runtime)).body, renderedProforma.body)
    const proformaPdf = await handleApiRequest({
      method: "GET", url: `/api/proformas/${proformaId}/pdf`, authorization, body: undefined,
    }, runtime)
    assert.equal(proformaPdf.status, 200)
    assert.equal(proformaPdf.headers?.["content-disposition"], `attachment; filename="proforma-${proformaId}.pdf"`)
    assert.equal(proformaPdf.headers.etag, `"sha256-${(renderedProforma.body as { sha256: string }).sha256}"`)
    assert.equal(proformaPdf.headers["content-type"], "application/pdf")
    assert.equal(Buffer.from((proformaPdf.body as Uint8Array).subarray(0, 5)).toString("ascii"), "%PDF-")
    const converted = await handleApiRequest({
      method: "POST", url: `/api/proformas/${proformaId}/invoice`, authorization, idempotencyKey: "convert-proforma-1", body: {},
    }, runtime)
    assert.equal(converted.status, 200)
    assert.equal((converted.body as { dueDate: string | null }).dueDate, null)
    assert.equal((converted.body as { draftId: string | null }).draftId, null)
    assert.equal((converted.body as { sourceProformaId: string | null }).sourceProformaId, proformaId)
    assert.deepEqual((converted.body as { source?: unknown }).source, { app: "crm", kind: "offer", id: "offer-1" })
    assert.deepEqual(await handleApiRequest({
      method: "POST", url: `/api/proformas/${proformaId}/invoice`, authorization, idempotencyKey: "convert-proforma-2", body: {},
    }, runtime), { status: 409, body: { error: "DomainConflict", code: "proforma_already_converted" } })
    assert.equal(typeof ((await handleApiRequest({
      method: "GET", url: `/api/proformas/${proformaId}`, authorization, body: undefined,
    }, runtime)).body as { convertedInvoiceId: string | null }).convertedInvoiceId, "string")
    const authoredBody = {
      customer: { partyType: "company", legalName: "Client CRM SRL", taxIdentifier: "RO87654329",
        address: { countryCode: "RO", city: "Iași", street: "Strada CRM 5" } },
      source: { app: "crm", kind: "contract", id: "contract-123" },
      series: "QWBE", issueDate: "2026-09-06", dueDate: null, currency: "RON",
      lines: [{ description: "Direct din CRM", quantity: "1", unitPrice: "25", unitOfMeasure: { code: "HUR", name: "oră" }, taxCode: "RO_STANDARD" }],
    }
    assert.equal((await handleApiRequest({ method: "POST", url: "/api/invoices", authorization,
      body: { ...authoredBody, lines: { description: "bad" } } }, runtime)).status, 400)
    assert.equal((await handleApiRequest({ method: "POST", url: "/api/invoices", authorization,
      body: authoredBody }, runtime)).status, 400)
    assert.equal((await handleApiRequest({ method: "POST", url: "/api/invoices", authorization,
      idempotencyKey: "invalid-unit", body: { ...authoredBody, lines: [{ ...authoredBody.lines[0], unitOfMeasure: { code: "NOPE", name: "inventată" } }] } }, runtime)).status, 400)
    const directInvoice = await handleApiRequest({ method: "POST", url: "/api/invoices", authorization, idempotencyKey: "direct-invoice-1", body: authoredBody }, runtime)
    assert.equal(directInvoice.status, 200)
    assert.equal((directInvoice.body as { draftId: string | null }).draftId, null)
    assert.deepEqual((directInvoice.body as { source?: unknown }).source, authoredBody.source)
    assert.deepEqual((await handleApiRequest({ method: "POST", url: "/api/invoices", authorization,
      idempotencyKey: "direct-invoice-1", body: authoredBody }, runtime)).body, directInvoice.body)
    assert.deepEqual(await handleApiRequest({ method: "POST", url: "/api/invoices", authorization,
      idempotencyKey: "direct-invoice-1", body: { ...authoredBody, dueDate: "2026-09-30" } }, runtime),
    { status: 409, body: { error: "DomainConflict", code: "idempotency_key_reused" } })
    assert.deepEqual((await handleApiRequest({ method: "GET",
      url: "/api/invoices?sourceApp=crm&sourceKind=contract&sourceId=contract-123", authorization, body: undefined }, runtime)).body,
    [directInvoice.body])
    assert.deepEqual((await handleApiRequest({ method: "GET",
      url: "/api/invoices?sourceApp=crm&sourceKind=contract&sourceId=missing", authorization, body: undefined }, runtime)).body, [])
    assert.equal((await handleApiRequest({ method: "GET", url: "/api/invoices?sourceApp=crm", authorization, body: undefined }, runtime)).status, 400)
    assert.deepEqual(await handleApiRequest({ method: "POST", url: "/api/proformas", authorization,
      idempotencyKey: "direct-invoice-1", body: { ...authoredBody, issueDate: "2026-09-07", proformaSeries: "PRO" } }, runtime),
    { status: 409, body: { error: "DomainConflict", code: "idempotency_key_reused" } })
    const directProforma = await handleApiRequest({ method: "POST", url: "/api/proformas", authorization,
      idempotencyKey: "direct-proforma-1", body: { ...authoredBody, issueDate: "2026-09-07", proformaSeries: "PRO" } }, runtime)
    assert.equal(directProforma.status, 200)
    assert.equal((directProforma.body as { sourceDraftId: string | null }).sourceDraftId, null)
    const directProformaId = (directProforma.body as { id: string }).id
    assert.equal((await handleApiRequest({ method: "POST", url: `/api/proformas/${directProformaId}/invoice`, authorization,
      idempotencyKey: "direct-proforma-conversion", body: {} }, runtime)).status, 200)
    assert.deepEqual((await handleApiRequest({ method: "GET", url: "/api/drafts", authorization, body: undefined }, runtime)).body, [])
    const correction = await handleApiRequest({
      method: "POST",
      url: `/api/invoices/${invoiceId}/corrections`,
      authorization,
      idempotencyKey: "correction-1",
      body: { reason: "Corecție integrală de test", issueDate: "2026-09-03",
        source: { app: "erp", kind: "return", id: "return-1" } },
    }, runtime)
    assert.equal(correction.status, 200)
    assert.equal((correction.body as { totalIncludingTax: string }).totalIncludingTax, "-121.00")
    assert.deepEqual((correction.body as { source?: unknown }).source, { app: "erp", kind: "return", id: "return-1" })
    const corrections = await handleApiRequest({
      method: "GET",
      url: `/api/invoices/${invoiceId}/corrections`,
      authorization,
      body: undefined,
    }, runtime)
    assert.equal((corrections.body as ReadonlyArray<unknown>).length, 1)
    assert.deepEqual((await handleApiRequest({ method: "GET",
      url: `/api/invoices/${invoiceId}/corrections?sourceApp=erp&sourceKind=return&sourceId=return-1`, authorization,
      body: undefined }, runtime)).body, [correction.body])
    const duplicateCorrection = await handleApiRequest({
      method: "POST",
      url: `/api/invoices/${invoiceId}/corrections`,
      authorization,
      idempotencyKey: "correction-2",
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
    for (const [method, url, body] of [
      ["POST", "/api/drafts/draft-1/proformas", { series: "PRO" }],
      ["GET", "/api/proformas", undefined],
      ["GET", "/api/proformas/proforma-1", undefined],
      ["POST", "/api/proformas/proforma-1/invoice", {}],
      ["POST", "/api/proformas/proforma-1/pdf", {}],
      ["GET", "/api/proformas/proforma-1/pdf", undefined],
    ] as const) {
      assert.equal((await handleApiRequest({ method, url, authorization: undefined, body }, {
        authenticate: createRequestAuthenticator({ host: "127.0.0.1", port: 3000, dataDirectory: directory,
          nodeEnvironment: "test", authTokenFile: undefined, organizationId: "org-1" }),
        dataDirectory: directory,
      })).status, 401)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
