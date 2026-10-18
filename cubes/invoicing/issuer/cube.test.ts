import assert from "node:assert/strict"
import test from "node:test"

import { cube, issuerMigrations } from "./index.ts"

void test("declares issuer ownership without redefining shared invoicing permissions", () => {
  assert.deepEqual(cube.manifest, {
    name: "issuer", parent: "invoicing", summary: "Issuer profile, branding, VAT registration and legal VAT catalogue",
    required: true, tables: ["issuers", "issuer_tax_configurations"],
    requiresAuth: true, permissions: [],
  })
  assert.deepEqual(cube.create(), { handlers: {} })
  assert.deepEqual(issuerMigrations.map(({ name }) => name), ["issuer-001-baseline"])
})
