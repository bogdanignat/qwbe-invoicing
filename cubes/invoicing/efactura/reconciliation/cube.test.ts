import assert from "node:assert/strict"
import test from "node:test"

import { cube } from "./index.ts"

void test("declares reconciliation as a required child of e-Factura that owns no table and grants efactura:reconcile", () => {
  assert.equal(cube.manifest.name, "reconciliation")
  assert.equal(cube.manifest.parent, "efactura")
  assert.equal(cube.manifest.required, true)
  assert.deepEqual(cube.manifest.tables, [])
  assert.deepEqual(cube.manifest.permissions, [{ name: "efactura:reconcile", roles: ["admin"] }])
})
