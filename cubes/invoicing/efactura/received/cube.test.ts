import assert from "node:assert/strict"
import test from "node:test"

import { cube } from "./index.ts"

void test("declares received as a required child of e-Factura that owns no table yet", () => {
  assert.equal(cube.manifest.name, "received")
  assert.equal(cube.manifest.parent, "efactura")
  assert.equal(cube.manifest.required, true)
  assert.deepEqual(cube.manifest.tables, [])
})
