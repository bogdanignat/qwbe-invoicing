import assert from "node:assert/strict"
import test from "node:test"

import { HttpApiGroup } from "@effect/platform"

import { cube } from "./index.ts"

void test("exports a minimal authenticated QWBE cube definition", () => {
  assert.equal(cube.manifest.name, "invoicing")
  assert.equal(cube.manifest.requiresAuth, true)
  assert.equal(cube.manifest.permissions.length, 7)
  assert.deepEqual(cube.manifest.tables, [
    "issuers",
    "issuer_tax_configurations",
    "customers",
    "invoice_drafts",
    "draft_lines",
    "invoice_sequences",
    "issued_invoices",
    "issued_lines",
    "issued_tax_breakdown",
    "invoice_payments",
    "correction_documents",
    "correction_lines",
    "correction_tax_breakdown",
  ])

  const parts = cube.create()
  assert.equal(HttpApiGroup.isHttpApiGroup(parts.group), true)
  assert.deepEqual(parts.handlers, {})
})
