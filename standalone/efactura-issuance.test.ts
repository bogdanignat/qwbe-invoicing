import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import type { ApiResponse } from "./api.test-support.ts"
import { handleApiRequest } from "./api.test-support.ts"
import { createRequestAuthenticator } from "./auth.ts"
import { applyMigrations, databasePath } from "./migrations.ts"
import { positiveInvoiceRequiresDueDate } from "../web/src/invoice-authoring-state.ts"

const missingDueDate = {
  status: 400,
  body: { error: "ValidationFailure", issues: ["dueDate is required for an invoice with a positive amount due"] },
} as const
const line = {
  description: "Servicii", quantity: "1", unitPrice: "100", unitOfMeasure: { code: "HUR", name: "oră" },
  vatRateCode: "RO_STANDARD",
} as const
const buyer = {
  partyType: "company", name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
  address: { countryCode: "RO", city: "Cluj-Napoca", street: "Strada Memorandumului 1", county: "RO-CJ" },
} as const

const fixture = async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-efactura-issuance-"))
  const token = "e".repeat(64)
  const tokenFile = join(directory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  applyMigrations(directory)
  const authorization = `Bearer ${token}`
  const runtime = {
    authenticate: createRequestAuthenticator({ host: "127.0.0.1", port: 3000, dataDirectory: directory,
      nodeEnvironment: "test", authTokenFile: tokenFile, organizationId: "org-1" }),
    dataDirectory: directory,
    now: () => new Date("2026-09-05T10:00:00.000Z"),
  }
  const call = (method: string, url: string, body: unknown, idempotencyKey?: string) =>
    handleApiRequest({ method, url, authorization, body, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) }, runtime)
  assert.equal((await call("PUT", "/api/issuer", {
    name: "Furnizor SRL", fiscalIdentifier: "12345674",
    address: { countryCode: "RO", city: "Iași", street: "Strada Palat 1", county: "RO-IS" },
    legalForm: "srl", tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000",
    bankName: "Banca", socialCapital: "1000", defaultCurrency: "RON", defaultPaymentTermDays: 15,
    vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null,
  })).status, 200)
  for (const [documentType, series] of [["invoice", "INV"], ["proforma", "PRO"]] as const) {
    assert.equal((await call("POST", "/api/document-series", { documentType, series })).status, 200)
  }
  return { directory, call, close: () => { rmSync(directory, { recursive: true, force: true }) } }
}

const scalar = (database: DatabaseSync, sql: string): number => {
  const value = Object.values(database.prepare(sql).get() ?? {})[0]
  assert.equal(typeof value, "number")
  return value as number
}

const issuanceState = (directory: string) => {
  const database = new DatabaseSync(databasePath(directory), { readOnly: true })
  try {
    for (const table of ["issued_invoices", "audit_events", "idempotency_records", "invoice_sequences"]) {
      assert.match(String(database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql), /STRICT$/)
    }
    return {
      invoices: scalar(database, "SELECT COUNT(*) FROM issued_invoices"),
      audits: scalar(database, "SELECT COUNT(*) FROM audit_events"),
      idempotency: scalar(database, "SELECT COUNT(*) FROM idempotency_records"),
      invoiceSequences: database.prepare("SELECT organization_id,fiscal_year,series,last_number FROM invoice_sequences WHERE document_type='invoice' ORDER BY organization_id,fiscal_year,series").all(),
    }
  } finally { database.close() }
}

void test("direct positive invoice rejects missing dueDate without consuming issuance state", async () => {
  const value = await fixture()
  try {
    const input = { customer: buyer, series: "INV", issueDate: "2026-09-05", currency: "RON", lines: [line] }
    const before = issuanceState(value.directory)
    assert.deepEqual(await value.call("POST", "/api/invoices", input, "missing-direct-due-date"), missingDueDate)
    assert.deepEqual(issuanceState(value.directory), before)
    const issued = await value.call("POST", "/api/invoices", { ...input, dueDate: "2026-09-20" }, "valid-direct")
    assert.equal(issued.status, 200)
    assert.equal((issued.body as { number: number }).number, 1)
  } finally { value.close() }
})

void test("positive draft may remain undated but issuance rejects it atomically", async () => {
  const value = await fixture()
  try {
    const draft = await value.call("POST", "/api/drafts", { customer: buyer, series: "INV", issueDate: "2026-09-05" })
    assert.equal(draft.status, 200)
    assert.equal((draft.body as { dueDate: string | null }).dueDate, null)
    const draftId = (draft.body as { id: string }).id
    const positive = await value.call("POST", `/api/drafts/${draftId}/lines`, line)
    assert.equal((positive.body as { totalIncludingVat: string }).totalIncludingVat, "121.00")
    const before = issuanceState(value.directory)
    assert.deepEqual(await value.call("POST", `/api/drafts/${draftId}/issue`, {}, "missing-draft-due-date"), missingDueDate)
    assert.deepEqual(issuanceState(value.directory), before)
    assert.equal(((await value.call("GET", `/api/drafts/${draftId}`, undefined)).body as { status: string }).status, "draft")
    assert.equal((await value.call("PUT", `/api/drafts/${draftId}`, {
      customer: buyer, issueDate: "2026-09-05", dueDate: "2026-09-20",
    })).status, 200)
    const issued = await value.call("POST", `/api/drafts/${draftId}/issue`, {}, "valid-draft")
    assert.equal(issued.status, 200)
    assert.equal((issued.body as { number: number }).number, 1)
  } finally { value.close() }
})

void test("positive undated proforma stays intact when invoice conversion is rejected", async () => {
  const value = await fixture()
  try {
    const input = { customer: buyer, proformaSeries: "PRO", issueDate: "2026-09-05", currency: "RON", lines: [line] }
    const proforma = await value.call("POST", "/api/proformas", input, "undated-proforma")
    assert.equal(proforma.status, 200)
    assert.equal((proforma.body as { dueDate: string | null }).dueDate, null)
    assert.equal((proforma.body as { totalIncludingVat: string }).totalIncludingVat, "121.00")
    const proformaId = (proforma.body as { id: string }).id
    const before = issuanceState(value.directory)
    assert.deepEqual(await value.call("POST", `/api/proformas/${proformaId}/invoice`, {
      invoiceSeries: "INV",
    }, "missing-conversion-due-date"), missingDueDate)
    assert.deepEqual(issuanceState(value.directory), before)
    assert.deepEqual((await value.call("GET", `/api/proformas/${proformaId}`, undefined)).body, proforma.body)

    const dated = await value.call("POST", "/api/proformas", { ...input, dueDate: "2026-09-20" }, "dated-proforma")
    assert.equal(dated.status, 200)
    const issued = await value.call("POST", `/api/proformas/${(dated.body as { id: string }).id}/invoice`, {
      invoiceSeries: "INV",
    }, "valid-conversion")
    assert.equal(issued.status, 200)
    assert.equal((issued.body as { number: number }).number, 1)
    assert.deepEqual((await value.call("GET", `/api/proformas/${proformaId}`, undefined)).body, proforma.body)
  } finally { value.close() }
})

void test("zero-value invoice permits an explicit null dueDate", async () => {
  const value = await fixture()
  try {
    const issued = await value.call("POST", "/api/invoices", {
      customer: buyer, series: "INV", issueDate: "2026-09-05", dueDate: null, currency: "RON",
      lines: [{ ...line, unitPrice: "0" }],
    }, "zero-invoice")
    assert.equal(issued.status, 200)
    assert.equal((issued.body as { dueDate: string | null }).dueDate, null)
    assert.equal((issued.body as { totalIncludingVat: string }).totalIncludingVat, "0.00")
    assert.equal((issued.body as { number: number }).number, 1)
  } finally { value.close() }
})

void test("unsaved UI due-date gating agrees with public invoice totals at the cent boundary", async () => {
  const value = await fixture()
  try {
    for (const quantity of ["0.0001", "0.0049", "0.0050", "0.0051", "1.0000"]) {
      const input = { ...line, quantity, unitPrice: "1.00" }
      const draft = await value.call("POST", "/api/drafts", { customer: buyer, series: "INV", issueDate: "2026-09-05" })
      assert.equal(draft.status, 200)
      const draftId = (draft.body as { id: string }).id
      const calculated = await value.call("POST", `/api/drafts/${draftId}/lines`, input)
      assert.equal(calculated.status, 200)
      const total = (calculated.body as { totalIncludingVat: string }).totalIncludingVat
      const needsDate = positiveInvoiceRequiresDueDate(null, undefined, [input])
      assert.equal(needsDate, total !== "0.00", quantity)
      const issued = await value.call("POST", `/api/drafts/${draftId}/issue`, {}, `rounded-${quantity}`)
      assert.equal(issued.status, needsDate ? 400 : 200, quantity)
    }
  } finally { value.close() }
})

/**
 * The export route, end to end: issue through the public API, then download
 * what would be uploaded to ANAF.
 *
 * These assertions name fiscal facts rather than re-deriving the bytes through
 * the mapper, which would only prove the test calls the same function twice.
 * What has to hold is that the document leaving the route carries the number
 * the invoice was issued under, the parties it was issued between and the
 * amount it was issued for.
 */
const exported = async (call: (method: string, url: string, body: unknown, key?: string) => Promise<ApiResponse>,
  url: string): Promise<{ readonly xml: string; readonly response: ApiResponse }> => {
  const response = await call("GET", url, undefined)
  assert.equal(response.status, 200, JSON.stringify(response.body))
  assert.match(response.headers?.["content-type"] ?? "", /^application\/xml/u)
  // `assert.equal` narrows its first argument, so the headers are known to be
  // there from here on and the optional chain above is the last one needed.
  assert.equal(response.headers?.["x-content-type-options"], "nosniff")
  assert.equal(typeof response.body, "string")
  const xml = response.body as string
  // The ETag is computed over what is actually sent, so it is checked against
  // that and not against the document the bytes were rendered from.
  assert.equal(response.headers.etag, `"sha256-${createHash("sha256").update(Buffer.from(xml, "utf8")).digest("hex")}"`)
  return { xml, response }
}

void test("an issued invoice downloads as the e-Factura document it maps to", async () => {
  const value = await fixture()
  try {
    const issued = await value.call("POST", "/api/invoices", {
      customer: buyer, series: "INV", issueDate: "2026-09-05", dueDate: "2026-09-20", currency: "RON", lines: [line],
    }, "efactura-export")
    assert.equal(issued.status, 200)
    const { xml, response } = await exported(value.call, `/api/invoices/${(issued.body as { id: string }).id}/efactura.xml`)

    // The filename is what lands in the upload dialog at anaf.ro/uploadxmi, so
    // it names the document rather than its internal identifier.
    assert.equal(response.headers?.["content-disposition"], 'attachment; filename="INV_1.xml"')
    assert.ok(xml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Invoice "), xml.slice(0, 120))
    assert.match(xml, /<cbc:ID>INV 1<\/cbc:ID>/u)
    assert.match(xml, /<cbc:InvoiceTypeCode>380<\/cbc:InvoiceTypeCode>/u)
    assert.match(xml, /<cbc:DocumentCurrencyCode>RON<\/cbc:DocumentCurrencyCode>/u)
    assert.match(xml, /<cbc:DueDate>2026-09-20<\/cbc:DueDate>/u)
    // BT-31 and BT-48: both parties are VAT registered here, and the stored CUI
    // carries no prefix, so the export is where `RO` is put in front of it.
    assert.match(xml, /<cbc:CompanyID>RO12345674<\/cbc:CompanyID>/u)
    assert.match(xml, /<cbc:CompanyID>RO87654329<\/cbc:CompanyID>/u)
    assert.match(xml, /<cbc:PayableAmount currencyID="RON">121\.00<\/cbc:PayableAmount>/u)
  } finally { value.close() }
})

void test("a correction downloads as the credit note that reverses its invoice", async () => {
  const value = await fixture()
  try {
    const issued = await value.call("POST", "/api/invoices", {
      customer: buyer, series: "INV", issueDate: "2026-09-05", dueDate: "2026-09-20", currency: "RON", lines: [line],
    }, "efactura-correction-source")
    assert.equal(issued.status, 200)
    const correction = await value.call("POST", `/api/invoices/${(issued.body as { id: string }).id}/corrections`,
      { reason: "Storno integral", issueDate: "2026-09-05" }, "efactura-correction")
    assert.equal(correction.status, 200, JSON.stringify(correction.body))
    assert.equal((correction.body as { totalIncludingVat: string }).totalIncludingVat, "-121.00")
    const exportedCorrection = await exported(value.call, `/api/corrections/${(correction.body as { id: string }).id}/efactura.xml`)
    const xml = exportedCorrection.xml
    // A correction carries its own number in the same series as the invoice it
    // reverses, and the filename names the credit note, not the invoice.
    assert.equal(exportedCorrection.response.headers?.["content-disposition"], 'attachment; filename="INV_2.xml"')

    assert.ok(xml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CreditNote "), xml.slice(0, 120))
    assert.match(xml, /<cbc:CreditNoteTypeCode>381<\/cbc:CreditNoteTypeCode>/u)
    // BG-3: a credit note names the invoice it corrects.
    assert.match(xml, /<cac:BillingReference>\s*<cac:InvoiceDocumentReference>\s*<cbc:ID>INV 1<\/cbc:ID>/u)
    // A correction stores its amounts negated; UBL expresses the same reversal
    // with a positive credit note, and the export is where the sign is dropped.
    assert.match(xml, /<cbc:PayableAmount currencyID="RON">121\.00<\/cbc:PayableAmount>/u)
    assert.doesNotMatch(xml, /-121\.00/u)
  } finally { value.close() }
})

void test("the export refuses a document e-Factura cannot carry, and says why", async () => {
  const value = await fixture()
  try {
    // BR-RO-L100 caps a line description at 100 characters. The invoicing domain
    // caps nothing at input (T-1390), so this invoice is issued, stored and
    // immutable — and only the export can refuse it. The refusal has to arrive
    // as the reason it is, not as an opaque failure: the caller is being told
    // that a document already in the books cannot be sent.
    const issued = await value.call("POST", "/api/invoices", {
      customer: buyer, series: "INV", issueDate: "2026-09-05", dueDate: "2026-09-20", currency: "RON",
      lines: [{ ...line, description: "Servicii ".repeat(20) }],
    }, "efactura-too-long")
    assert.equal(issued.status, 200)
    const response = await value.call("GET", `/api/invoices/${(issued.body as { id: string }).id}/efactura.xml`, undefined)
    assert.equal(response.status, 400)
    const body = response.body as { error: string; issues: ReadonlyArray<string> }
    assert.equal(body.error, "ValidationFailure")
    assert.deepEqual(body.issues, ["lines[0].name exceeds 100 characters after normalize-space (BR-RO-L100)"])
  } finally { value.close() }
})

void test("the export answers for documents that do not exist and callers that do not identify themselves", async () => {
  const value = await fixture()
  try {
    for (const url of ["/api/invoices/missing-invoice/efactura.xml", "/api/corrections/missing-correction/efactura.xml"]) {
      assert.deepEqual(await value.call("GET", url, undefined), { status: 404, body: { error: "ResourceNotFound" } }, url)
      // The same route without credentials stops before it reads anything.
      assert.equal((await handleApiRequest({ method: "GET", url, authorization: undefined, body: undefined },
        { authenticate: createRequestAuthenticator({ host: "127.0.0.1", port: 3000, dataDirectory: value.directory,
          nodeEnvironment: "test", authTokenFile: join(value.directory, "api-token"), organizationId: "org-1" }),
          dataDirectory: value.directory })).status, 401, url)
    }
  } finally { value.close() }
})
