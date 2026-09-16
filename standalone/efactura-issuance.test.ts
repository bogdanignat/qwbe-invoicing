import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

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
