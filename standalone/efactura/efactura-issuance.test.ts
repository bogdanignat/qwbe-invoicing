import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import type { ApiResponse } from "../api/api.test-support.ts"
import { handleApiRequest } from "../api/api.test-support.ts"
import { createRequestAuthenticator } from "../auth/auth.ts"
import { migratedFixture, type RawSql, type TestFixture } from "../storage/postgres-rig.test-support.ts"

/**
 * The e-Factura routes over PostgreSQL. The API fixture now carries the pool,
 * and the issuance-state snapshot is four awaited queries instead of a read-only
 * `DatabaseSync`.
 *
 * `STRICT` has no counterpart and needs none: a PostgreSQL column has a type
 * unconditionally. What that table assertion was really protecting — that
 * `number`, `fiscal_year` and `last_number` are integers and the money is text,
 * so nothing silently coerces — is asserted against the catalogue instead.
 */

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

const fixture = async (label: string) => {
  const rig = await migratedFixture(`efa_${label}`)
  const token = "e".repeat(64)
  const tokenFile = join(rig.dataDirectory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  const authorization = `Bearer ${token}`
  const runtime = {
    authenticate: createRequestAuthenticator(rig.config({ authTokenFile: tokenFile })),
    pool: rig.pool,
    dataDirectory: rig.dataDirectory,
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
  return { rig, call, close: () => rig.close() }
}

/** `count(*)` is `bigint`, which arrives as text; a count is a number here. */
const counted = async (sql: RawSql, statement: string): Promise<number> => {
  const value = await sql.scalar(statement)
  assert.equal(typeof value, "string", statement)
  return Number(value)
}

const issuanceState = async (rig: TestFixture) => {
  const { sql } = rig
  // What `STRICT` stood for: the stored types, read from the catalogue.
  assert.deepEqual(await sql.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name, column_name) IN (('issued_invoices','number'), ('issued_invoices','fiscal_year'),
         ('issued_invoices','total_including_tax'), ('invoice_sequences','last_number'),
         ('audit_events','occurred_at'), ('idempotency_records','created_at'))
     ORDER BY table_name, column_name`,
  ), [
    { table_name: "audit_events", column_name: "occurred_at", data_type: "text" },
    { table_name: "idempotency_records", column_name: "created_at", data_type: "text" },
    { table_name: "invoice_sequences", column_name: "last_number", data_type: "integer" },
    { table_name: "issued_invoices", column_name: "fiscal_year", data_type: "integer" },
    { table_name: "issued_invoices", column_name: "number", data_type: "integer" },
    { table_name: "issued_invoices", column_name: "total_including_tax", data_type: "text" },
  ])
  return {
    invoices: await counted(sql, "SELECT count(*) FROM issued_invoices"),
    audits: await counted(sql, "SELECT count(*) FROM audit_events"),
    idempotency: await counted(sql, "SELECT count(*) FROM idempotency_records"),
    invoiceSequences: await sql.query(`SELECT organization_id,fiscal_year,series,last_number FROM invoice_sequences
      WHERE document_type='invoice' ORDER BY organization_id,fiscal_year,series`),
  }
}

void test("direct positive invoice rejects missing dueDate without consuming issuance state", async () => {
  const value = await fixture("direct_due")
  try {
    const input = { customer: buyer, series: "INV", issueDate: "2026-09-05", currency: "RON", lines: [line] }
    const before = await issuanceState(value.rig)
    assert.deepEqual(await value.call("POST", "/api/invoices", input, "missing-direct-due-date"), missingDueDate)
    assert.deepEqual(await issuanceState(value.rig), before)
    const issued = await value.call("POST", "/api/invoices", { ...input, dueDate: "2026-09-20" }, "valid-direct")
    assert.equal(issued.status, 200)
    assert.equal((issued.body as { number: number }).number, 1)
  } finally { await value.close() }
})

void test("positive draft may remain undated but issuance rejects it atomically", async () => {
  const value = await fixture("draft_due")
  try {
    const draft = await value.call("POST", "/api/drafts", { customer: buyer, series: "INV", issueDate: "2026-09-05" }, "efactura-draft-1")
    assert.equal(draft.status, 200)
    assert.equal((draft.body as { dueDate: string | null }).dueDate, null)
    const draftId = (draft.body as { id: string }).id
    const positive = await value.call("POST", `/api/drafts/${draftId}/lines`, line)
    assert.equal((positive.body as { totalIncludingVat: string }).totalIncludingVat, "121.00")
    const before = await issuanceState(value.rig)
    assert.deepEqual(await value.call("POST", `/api/drafts/${draftId}/issue`, {}, "missing-draft-due-date"), missingDueDate)
    assert.deepEqual(await issuanceState(value.rig), before)
    assert.equal(((await value.call("GET", `/api/drafts/${draftId}`, undefined)).body as { status: string }).status, "draft")
    assert.equal((await value.call("PUT", `/api/drafts/${draftId}`, {
      customer: buyer, issueDate: "2026-09-05", dueDate: "2026-09-20",
    })).status, 200)
    const issued = await value.call("POST", `/api/drafts/${draftId}/issue`, {}, "valid-draft")
    assert.equal(issued.status, 200)
    assert.equal((issued.body as { number: number }).number, 1)
  } finally { await value.close() }
})

void test("positive undated proforma stays intact when invoice conversion is rejected", async () => {
  const value = await fixture("proforma_due")
  try {
    const input = { customer: buyer, proformaSeries: "PRO", issueDate: "2026-09-05", currency: "RON", lines: [line] }
    const proforma = await value.call("POST", "/api/proformas", input, "undated-proforma")
    assert.equal(proforma.status, 200)
    assert.equal((proforma.body as { dueDate: string | null }).dueDate, null)
    assert.equal((proforma.body as { totalIncludingVat: string }).totalIncludingVat, "121.00")
    const proformaId = (proforma.body as { id: string }).id
    const before = await issuanceState(value.rig)
    assert.deepEqual(await value.call("POST", `/api/proformas/${proformaId}/invoice`, {
      invoiceSeries: "INV",
    }, "missing-conversion-due-date"), missingDueDate)
    assert.deepEqual(await issuanceState(value.rig), before)
    assert.deepEqual((await value.call("GET", `/api/proformas/${proformaId}`, undefined)).body, proforma.body)

    const dated = await value.call("POST", "/api/proformas", { ...input, dueDate: "2026-09-20" }, "dated-proforma")
    assert.equal(dated.status, 200)
    const issued = await value.call("POST", `/api/proformas/${(dated.body as { id: string }).id}/invoice`, {
      invoiceSeries: "INV",
    }, "valid-conversion")
    assert.equal(issued.status, 200)
    assert.equal((issued.body as { number: number }).number, 1)
    assert.deepEqual((await value.call("GET", `/api/proformas/${proformaId}`, undefined)).body, proforma.body)
  } finally { await value.close() }
})

void test("zero-value invoice permits an explicit null dueDate", async () => {
  const value = await fixture("zero_due")
  try {
    const issued = await value.call("POST", "/api/invoices", {
      customer: buyer, series: "INV", issueDate: "2026-09-05", dueDate: null, currency: "RON",
      lines: [{ ...line, unitPrice: "0" }],
    }, "zero-invoice")
    assert.equal(issued.status, 200)
    assert.equal((issued.body as { dueDate: string | null }).dueDate, null)
    assert.equal((issued.body as { totalIncludingVat: string }).totalIncludingVat, "0.00")
    assert.equal((issued.body as { number: number }).number, 1)
  } finally { await value.close() }
})

void test("issue without dueDate is refused exactly when the rounded total is non-zero", async () => {
  const value = await fixture("cent_bound")
  try {
    for (const quantity of ["0.0001", "0.0049", "0.0050", "0.0051", "1.0000"]) {
      const input = { ...line, quantity, unitPrice: "1.00" }
      const draft = await value.call("POST", "/api/drafts", { customer: buyer, series: "INV", issueDate: "2026-09-05" }, `efactura-draft-${quantity}`)
      assert.equal(draft.status, 200)
      const draftId = (draft.body as { id: string }).id
      const calculated = await value.call("POST", `/api/drafts/${draftId}/lines`, input)
      assert.equal(calculated.status, 200)
      const total = (calculated.body as { totalIncludingVat: string }).totalIncludingVat
      const needsDate = total !== "0.00"
      const issued = await value.call("POST", `/api/drafts/${draftId}/issue`, {}, `rounded-${quantity}`)
      assert.equal(issued.status, needsDate ? 400 : 200, quantity)
    }
  } finally { await value.close() }
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
  const value = await fixture("export_inv")
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
  } finally { await value.close() }
})

void test("a correction downloads as the credit note that reverses its invoice", async () => {
  const value = await fixture("export_corr")
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
  } finally { await value.close() }
})

void test("a line description e-Factura cannot carry is refused when it is entered, not at export", async () => {
  const value = await fixture("export_refuse")
  try {
    // BR-RO-L100 caps an item name at 100 characters. The domain enforces it at input
    // (T-1390), so an issued invoice can no longer hold a description the export
    // would refuse; the export's own refusal stays covered in cube/efactura.
    const issued = await value.call("POST", "/api/invoices", {
      customer: buyer, series: "INV", issueDate: "2026-09-05", dueDate: "2026-09-20", currency: "RON",
      lines: [{ ...line, description: "Servicii ".repeat(20) }],
    }, "efactura-too-long")
    assert.equal(issued.status, 400)
    const body = issued.body as { error: string; issues: ReadonlyArray<string> }
    assert.equal(body.error, "ValidationFailure")
    assert.deepEqual(body.issues, ["description must be at most 100 characters"])
  } finally { await value.close() }
})

void test("the export answers for documents that do not exist and callers that do not identify themselves", async () => {
  const value = await fixture("export_missing")
  try {
    for (const url of ["/api/invoices/missing-invoice/efactura.xml", "/api/corrections/missing-correction/efactura.xml"]) {
      assert.deepEqual(await value.call("GET", url, undefined), { status: 404, body: { error: "ResourceNotFound" } }, url)
      // The same route without credentials stops before it reads anything.
      assert.equal((await handleApiRequest({ method: "GET", url, authorization: undefined, body: undefined },
        { authenticate: createRequestAuthenticator(value.rig.config({
          authTokenFile: join(value.rig.dataDirectory, "api-token") })),
          pool: value.rig.pool, dataDirectory: value.rig.dataDirectory })).status, 401, url)
    }
  } finally { await value.close() }
})
