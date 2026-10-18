import assert from "node:assert/strict"
import test from "node:test"

import { cube } from "./index.ts"

void test("declares e-Factura as an optional plugin of invoicing that owns no table", () => {
  assert.equal(cube.manifest.name, "efactura")
  assert.equal(cube.manifest.parent, "invoicing")
  assert.equal(cube.manifest.required, false)
  assert.deepEqual(cube.manifest.tables, [])
})
