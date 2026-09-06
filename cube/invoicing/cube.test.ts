import assert from "node:assert/strict"
import test from "node:test"

import { cube } from "./index.ts"
import { invoicingMigrations } from "./contracts/migrations.ts"

void test("exports a minimal authenticated QWBE cube definition", () => {
  assert.equal(cube.manifest.name, "invoicing")
  assert.equal(cube.manifest.requiresAuth, true)
  assert.equal(cube.manifest.permissions.length, 8)
  assert.deepEqual(cube.manifest.tables, [
    "issuers",
    "issuer_tax_configurations",
    "document_series",
    "customers",
    "product_presets",
    "invoice_drafts",
    "draft_lines",
    "invoice_sequences",
    "issued_invoices",
    "issued_lines",
    "issued_tax_breakdown",
    "proformas",
    "proforma_lines",
    "proforma_tax_breakdown",
    "proforma_conversions",
    "proforma_invoice_conversions",
    "correction_documents",
    "correction_lines",
    "correction_tax_breakdown",
    "idempotency_records", "audit_events",
  ])

  assert.equal(invoicingMigrations.at(-1)?.name, "016-drop-e-factura-status")
  assert.equal(invoicingMigrations.filter(({ name }) => name === "008-proforma-workflow").length, 1)
  assert.equal(invoicingMigrations.filter(({ name }) => name === "009-proforma-direct-invoice").length, 1)
  assert.equal(invoicingMigrations.filter(({ name }) => name === "010-product-presets-payment-terms").length, 1)
  assert.equal(invoicingMigrations.filter(({ name }) => name === "011-external-api-snapshots").length, 1)
  assert.equal(invoicingMigrations.filter(({ name }) => name === "013-audit-trail").length, 1)
})
